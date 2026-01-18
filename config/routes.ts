export default [
  {
    path: '/user/login',
    component: './user/login',
    layout: false,
  },
  {
    path: '/project/create',
    component: './project/create',
    layout: false,
  },
  {
    path: '/workspace',
    component: './workspace',
  },
  {
    path: '/applications',
    component: './applications',
  },
  {
    path: '/governance',
    component: './governance',
  },
  {
    path: '/dependency-view',
    redirect: '/diagrams/application-dependency',
  },
  {
    path: '/diagrams/application-dependency',
    component: './dependency-view',
  },
  {
    path: '/diagrams/application-landscape',
    component: './dependency-view',
  },
  {
    path: '/diagrams/capability-map',
    component: './dependency-view',
  },
  {
    path: '/diagrams/application-technology',
    component: './dependency-view',
  },
  {
    path: '/diagrams/technology-landscape',
    component: './dependency-view',
  },
  {
    path: '/impact-analysis',
    component: './impact-analysis',
  },
  {
    path: '/interoperability',
    component: './interoperability',
  },
  {
    path: '/views/create',
    component: './views/create',
  },
  {
    name: 'view-runtime',
    path: '/views/:viewId',
    component: './views/view',
  },
  {
    path: '/studio/:workspaceId',
    component: './studio',
    layout: false,
  },
  {
    path: '/',
    redirect: '/workspace',
  },
  {
    component: '404',
    layout: false,
    path: '/404',
  },
];
