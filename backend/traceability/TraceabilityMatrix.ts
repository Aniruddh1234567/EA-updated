import type { BaseArchitectureElement } from '../repository/BaseArchitectureElement';
import type { BaseArchitectureRelationship } from '../repository/BaseArchitectureRelationship';
import type { AdrRepository } from '../adr/AdrRepository';
import type { ViewRepository } from '../views/ViewRepository';
import { viewResolver } from '../views/ViewResolver';
import type { GraphAbstractionLayer } from '../graph/GraphAbstractionLayer';

export type TraceabilityNodeKind = 'Element' | 'ADR' | 'View' | 'Unknown';

export type TraceabilityNode = {
  kind: TraceabilityNodeKind;
  id: string;
  elementType?: string;
  name?: string;
};

export type TraceabilityEdge = {
  /** Relationship id for real edges; deterministic synthetic id for pseudo-edges. */
  id: string;
  relationshipType: string;
  fromId: string;
  toId: string;
  status?: string;
  rationale?: string;
};

export type TraceabilityPath = {
  nodes: readonly TraceabilityNode[];
  edges: readonly TraceabilityEdge[];
};

export type TraceabilityResult = {
  subject: { kind: 'Capability' | 'Programme' | 'ADR'; id: string };
  involvedElementIds: readonly string[];
  paths: readonly TraceabilityPath[];
  warnings: readonly string[];
};

const normalizeId = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const uniqSorted = (values: readonly string[]) =>
  Array.from(
    new Set((values ?? []).map((v) => normalizeId(v)).filter((v) => v.length > 0)),
  ).sort(compareStrings);

const sortRelationshipsDeterministically = (rels: BaseArchitectureRelationship[]) =>
  rels.sort(
    (a, b) =>
      (a.relationshipType ?? '').localeCompare(b.relationshipType ?? '') ||
      (a.sourceElementId ?? '').localeCompare(b.sourceElementId ?? '') ||
      (a.targetElementId ?? '').localeCompare(b.targetElementId ?? '') ||
      (a.id ?? '').localeCompare(b.id ?? ''),
  );

const buildElementNode = async (graph: GraphAbstractionLayer, elementId: string): Promise<TraceabilityNode> => {
  const id = normalizeId(elementId);
  const e = id ? await graph.getNode(id) : null;
  if (!e) return { kind: 'Unknown', id, elementType: 'Unknown', name: undefined };
  return { kind: 'Element', id: e.id, elementType: e.elementType, name: (e as BaseArchitectureElement).name };
};

const buildRelationshipEdge = (rel: BaseArchitectureRelationship): TraceabilityEdge => ({
  id: rel.id,
  relationshipType: rel.relationshipType,
  fromId: rel.sourceElementId,
  toId: rel.targetElementId,
  status: rel.status,
  rationale: rel.rationale,
});

const buildPseudoEdge = (relationshipType: string, fromId: string, toId: string): TraceabilityEdge => ({
  id: `pseudo:${relationshipType}:${normalizeId(fromId)}->${normalizeId(toId)}`,
  relationshipType,
  fromId: normalizeId(fromId),
  toId: normalizeId(toId),
});

/**
 * TraceabilityMatrix (read-only, deterministic).
 *
 * Goal: enable answering “why does this exist?” by returning stable, explorable relationship paths.
 */
export class TraceabilityMatrix {
  private readonly graph: GraphAbstractionLayer;
  private readonly views: ViewRepository;
  private readonly adrs: AdrRepository;

  constructor(args: {
    graph: GraphAbstractionLayer;
    views: ViewRepository;
    adrs: AdrRepository;
  }) {
    this.graph = args.graph;
    this.views = args.views;
    this.adrs = args.adrs;
  }

  /** Capability → BusinessProcess → Application → Technology */
  async traceCapabilityToApplicationToTechnology(capabilityId: string): Promise<TraceabilityResult> {
    const capId = normalizeId(capabilityId);
    const warnings: string[] = [];
    if (!capId) {
      return { subject: { kind: 'Capability', id: '' }, involvedElementIds: [], paths: [], warnings: ['capabilityId is required.'] };
    }

    const cap = await this.graph.getNode(capId);
    if (!cap) warnings.push(`Unknown Capability id: "${capId}".`);
    else if (cap.elementType !== 'Capability') warnings.push(`Element "${capId}" is not a Capability (got "${cap.elementType}").`);

    const capOutgoing = await this.graph.getOutgoingEdges(capId);
    const realizedBy = sortRelationshipsDeterministically(
      capOutgoing.filter((r) => (r.relationshipType ?? '').trim() === 'REALIZED_BY'),
    );

    const paths: TraceabilityPath[] = [];
    const pathKeySet = new Set<string>();
    const involved = new Set<string>();
    involved.add(capId);

    if (realizedBy.length === 0)
      warnings.push(`No REALIZED_BY relationships found for Capability "${capId}".`);

    for (const capToProc of realizedBy) {
      const processId = normalizeId(capToProc.targetElementId);
      if (!processId) continue;
      involved.add(processId);

      const procOutgoing = await this.graph.getOutgoingEdges(processId);
      const realizes = sortRelationshipsDeterministically(
        procOutgoing.filter((r) => (r.relationshipType ?? '').trim() === 'SERVED_BY'),
      );

      if (realizes.length === 0) {
        // Still record partial trace (Capability → Process) to support “why” even when mapping is incomplete.
        const key = `${capId}|${processId}|partial`;
        if (!pathKeySet.has(key)) {
          pathKeySet.add(key);
          paths.push({
            nodes: [await buildElementNode(this.graph, capId), await buildElementNode(this.graph, processId)],
            edges: [buildRelationshipEdge(capToProc)],
          });
        }
        continue;
      }

      for (const procToApp of realizes) {
        const applicationId = normalizeId(procToApp.targetElementId);
        if (!applicationId) continue;
        involved.add(applicationId);

        const appOutgoing = await this.graph.getOutgoingEdges(applicationId);
        const hostedOn = sortRelationshipsDeterministically(
          appOutgoing.filter((r) => (r.relationshipType ?? '').trim() === 'DEPLOYED_ON'),
        );

        if (hostedOn.length === 0) {
          const key = `${capId}|${processId}|${applicationId}|partial`;
          if (!pathKeySet.has(key)) {
            pathKeySet.add(key);
            paths.push({
              nodes: [
                await buildElementNode(this.graph, capId),
                await buildElementNode(this.graph, processId),
                await buildElementNode(this.graph, applicationId),
              ],
              edges: [buildRelationshipEdge(capToProc), buildRelationshipEdge(procToApp)],
            });
          }
          continue;
        }

        for (const appToTech of hostedOn) {
          const technologyId = normalizeId(appToTech.targetElementId);
          if (!technologyId) continue;
          involved.add(technologyId);

          const key = `${capId}|${processId}|${applicationId}|${technologyId}|${capToProc.id}|${procToApp.id}|${appToTech.id}`;
          if (pathKeySet.has(key)) continue;
          pathKeySet.add(key);

          paths.push({
            nodes: [
              await buildElementNode(this.graph, capId),
              await buildElementNode(this.graph, processId),
              await buildElementNode(this.graph, applicationId),
              await buildElementNode(this.graph, technologyId),
            ],
            edges: [buildRelationshipEdge(capToProc), buildRelationshipEdge(procToApp), buildRelationshipEdge(appToTech)],
          });
        }
      }
    }

    // Deterministic final ordering.
    paths.sort((a, b) => {
      const aSig = a.nodes.map((n) => n.id).join('>');
      const bSig = b.nodes.map((n) => n.id).join('>');
      return aSig.localeCompare(bSig);
    });

    return {
      subject: { kind: 'Capability', id: capId },
      involvedElementIds: Array.from(involved).sort(compareStrings),
      paths,
      warnings: warnings.sort(compareStrings),
    };
  }

  /** Programme → (Capability | Application | Technology), with deterministic derived expansions. */
  async traceProgrammeImpact(programmeId: string): Promise<TraceabilityResult> {
    const progId = normalizeId(programmeId);
    const warnings: string[] = [];
    if (!progId) {
      return { subject: { kind: 'Programme', id: '' }, involvedElementIds: [], paths: [], warnings: ['programmeId is required.'] };
    }

    const programme = await this.graph.getNode(progId);
    if (!programme) warnings.push(`Unknown Programme id: "${progId}".`);
    else if (programme.elementType !== 'Programme') warnings.push(`Element "${progId}" is not a Programme (got "${programme.elementType}").`);

    const outgoing = await this.graph.getOutgoingEdges(progId);
    const impacts = sortRelationshipsDeterministically(
      outgoing.filter((r) => (r.relationshipType ?? '').trim() === 'IMPACTS'),
    );

    const involved = new Set<string>();
    involved.add(progId);

    const paths: TraceabilityPath[] = [];
    const keySet = new Set<string>();

    if (impacts.length === 0) warnings.push(`No IMPACTS relationships found for Programme "${progId}".`);

    for (const impactRel of impacts) {
      const targetId = normalizeId(impactRel.targetElementId);
      if (!targetId) continue;
      involved.add(targetId);

      // Always include direct Programme → Target.
      {
        const key = `direct|${progId}|${targetId}|${impactRel.id}`;
        if (!keySet.has(key)) {
          keySet.add(key);
          paths.push({
            nodes: [await buildElementNode(this.graph, progId), await buildElementNode(this.graph, targetId)],
            edges: [buildRelationshipEdge(impactRel)],
          });
        }
      }

      const target = await this.graph.getNode(targetId);
      const targetType = (target?.elementType ?? impactRel.targetElementType ?? '').trim();

      // Deterministic expansion rules:
      // - If target is a Capability: expand to Capability→Process→Application→Technology.
      // - If target is an Application: expand to Application→Technology.
      // - If target is a Technology: no expansion.
      if (targetType === 'Capability') {
        const capTrace = await this.traceCapabilityToApplicationToTechnology(targetId);
        for (const capPath of capTrace.paths) {
          // capPath already begins at the Capability; prefix Programme + IMPACTS edge.
          const capFirst = capPath.nodes[0];
          if (!capFirst || normalizeId(capFirst.id) !== targetId) continue;

          const expandedNodes: TraceabilityNode[] = [await buildElementNode(this.graph, progId), ...capPath.nodes];
          const expandedEdges: TraceabilityEdge[] = [buildRelationshipEdge(impactRel), ...capPath.edges];

          for (const n of capPath.nodes) if (n.kind === 'Element' || n.kind === 'Unknown') involved.add(n.id);

          const key = `expanded|${expandedNodes.map((n) => n.id).join('>')}|${expandedEdges.map((e) => e.id).join('>')}`;
          if (keySet.has(key)) continue;
          keySet.add(key);
          paths.push({ nodes: expandedNodes, edges: expandedEdges });
        }
      } else if (targetType === 'Application') {
        const appOutgoing = await this.graph.getOutgoingEdges(targetId);
        const hostedOn = sortRelationshipsDeterministically(
          appOutgoing.filter((r) => (r.relationshipType ?? '').trim() === 'DEPLOYED_ON'),
        );

        for (const appToTech of hostedOn) {
          const techId = normalizeId(appToTech.targetElementId);
          if (!techId) continue;
          involved.add(techId);

          const expandedNodes = [
            await buildElementNode(this.graph, progId),
            await buildElementNode(this.graph, targetId),
            await buildElementNode(this.graph, techId),
          ];
          const expandedEdges = [buildRelationshipEdge(impactRel), buildRelationshipEdge(appToTech)];
          const key = `expanded|${expandedNodes.map((n) => n.id).join('>')}|${expandedEdges.map((e) => e.id).join('>')}`;
          if (keySet.has(key)) continue;
          keySet.add(key);
          paths.push({ nodes: expandedNodes, edges: expandedEdges });
        }
      }
    }

    paths.sort((a, b) => {
      const aSig = a.nodes.map((n) => n.id).join('>');
      const bSig = b.nodes.map((n) => n.id).join('>');
      return aSig.localeCompare(bSig);
    });

    return {
      subject: { kind: 'Programme', id: progId },
      involvedElementIds: Array.from(involved).sort(compareStrings),
      paths,
      warnings: warnings.sort(compareStrings),
    };
  }

  /** ADR → impacted elements (direct relatedElements + elements projected by relatedViews). */
  async traceAdrImpactedElements(adrId: string): Promise<TraceabilityResult> {
    const id = normalizeId(adrId);
    const warnings: string[] = [];
    if (!id) {
      return { subject: { kind: 'ADR', id: '' }, involvedElementIds: [], paths: [], warnings: ['adrId is required.'] };
    }

    const adr = this.adrs.getById(id);
    if (!adr) {
      return {
        subject: { kind: 'ADR', id },
        involvedElementIds: [],
        paths: [],
        warnings: [`ADR not found: "${id}".`],
      };
    }

    const adrNode: TraceabilityNode = { kind: 'ADR', id: adr.adrId, name: adr.title };

    const paths: TraceabilityPath[] = [];
    const involved = new Set<string>();
    const keySet = new Set<string>();

    const relatedElements = uniqSorted(adr.relatedElements);
    const relatedViews = uniqSorted(adr.relatedViews);

    for (const elementId of relatedElements) {
      involved.add(elementId);

      const edge = buildPseudoEdge('ADR_RELATES_TO_ELEMENT', adr.adrId, elementId);
      const key = `adr-element|${edge.id}`;
      if (!keySet.has(key)) {
        keySet.add(key);
        paths.push({
          nodes: [adrNode, await buildElementNode(this.graph, elementId)],
          edges: [edge],
        });
      }

      // Deterministic derived expansion (same rules as Programme expansion, anchored at the referenced element).
      const element = await this.graph.getNode(elementId);
      const elementType = (element?.elementType ?? '').trim();
      if (elementType === 'Capability') {
        const capTrace = await this.traceCapabilityToApplicationToTechnology(elementId);
        for (const capPath of capTrace.paths) {
          const expandedNodes: TraceabilityNode[] = [adrNode, ...capPath.nodes];
          const expandedEdges: TraceabilityEdge[] = [edge, ...capPath.edges];
          for (const n of capPath.nodes) if (n.kind === 'Element' || n.kind === 'Unknown') involved.add(n.id);

          const k = `expanded|${expandedNodes.map((n) => n.id).join('>')}|${expandedEdges.map((e) => e.id).join('>')}`;
          if (keySet.has(k)) continue;
          keySet.add(k);
          paths.push({ nodes: expandedNodes, edges: expandedEdges });
        }
      } else if (elementType === 'Application') {
        const appOutgoing = await this.graph.getOutgoingEdges(elementId);
        const hostedOn = sortRelationshipsDeterministically(
          appOutgoing.filter((r) => (r.relationshipType ?? '').trim() === 'DEPLOYED_ON'),
        );
        for (const appToTech of hostedOn) {
          const techId = normalizeId(appToTech.targetElementId);
          if (!techId) continue;
          involved.add(techId);

          const expandedNodes = [adrNode, await buildElementNode(this.graph, elementId), await buildElementNode(this.graph, techId)];
          const expandedEdges = [edge, buildRelationshipEdge(appToTech)];
          const k = `expanded|${expandedNodes.map((n) => n.id).join('>')}|${expandedEdges.map((e) => e.id).join('>')}`;
          if (keySet.has(k)) continue;
          keySet.add(k);
          paths.push({ nodes: expandedNodes, edges: expandedEdges });
        }
      }
    }

    for (const viewId of relatedViews) {
      let view;
      try {
        view = this.views.getViewById(viewId);
      } catch {
        view = null;
      }

      if (!view) {
        warnings.push(`Related view not found: "${viewId}".`);
        const edge = buildPseudoEdge('ADR_RELATES_TO_VIEW', adr.adrId, viewId);
        const key = `adr-view-missing|${edge.id}`;
        if (!keySet.has(key)) {
          keySet.add(key);
          paths.push({ nodes: [adrNode, { kind: 'View', id: viewId }], edges: [edge] });
        }
        continue;
      }

      const viewNode: TraceabilityNode = { kind: 'View', id: view.id, name: view.name };
      const viewEdge = buildPseudoEdge('ADR_RELATES_TO_VIEW', adr.adrId, view.id);

      {
        const key = `adr-view|${viewEdge.id}`;
        if (!keySet.has(key)) {
          keySet.add(key);
          paths.push({ nodes: [adrNode, viewNode], edges: [viewEdge] });
        }
      }

      // Resolve view deterministically and link to its selected elements.
      const resolved = await viewResolver.resolve(view);
      for (const elementId of resolved.elementIds ?? []) {
        const elId = normalizeId(elementId);
        if (!elId) continue;
        involved.add(elId);
        const edge = buildPseudoEdge('VIEW_INCLUDES_ELEMENT', view.id, elId);
        const key = `view-element|${edge.id}`;
        if (keySet.has(key)) continue;
        keySet.add(key);
        paths.push({ nodes: [adrNode, viewNode, await buildElementNode(this.graph, elId)], edges: [viewEdge, edge] });
      }
    }

    paths.sort((a, b) => {
      const aSig = a.nodes.map((n) => `${n.kind}:${n.id}`).join('>');
      const bSig = b.nodes.map((n) => `${n.kind}:${n.id}`).join('>');
      return aSig.localeCompare(bSig);
    });

    return {
      subject: { kind: 'ADR', id },
      involvedElementIds: Array.from(involved).sort(compareStrings),
      paths,
      warnings: warnings.sort(compareStrings),
    };
  }
}
