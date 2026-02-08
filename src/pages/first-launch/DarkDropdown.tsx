import React from 'react';
import ReactDOM from 'react-dom';
import styles from './DarkDropdown.module.less';

export interface DarkDropdownOption {
  value: string;
  label: string;
}

interface DarkDropdownProps {
  value?: string;
  onChange?: (value: string) => void;
  options: DarkDropdownOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  direction: 'down' | 'up';
}

/**
 * Pure div/button dropdown — zero native <select> elements.
 * Menu renders via portal to document.body with position:fixed.
 * VS Code / JetBrains style, fully keyboard-accessible.
 */
const DarkDropdown: React.FC<DarkDropdownProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select\u2026',
  disabled = false,
  id,
}) => {
  const [open, setOpen] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(-1);
  const [menuPos, setMenuPos] = React.useState<MenuPosition | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  const MENU_MAX_HEIGHT = 240;
  const MENU_GAP = 3;

  /** Compute fixed position anchored to the trigger button */
  const computePosition = React.useCallback((): MenuPosition | null => {
    const el = triggerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const direction = spaceBelow >= Math.min(MENU_MAX_HEIGHT, options.length * 32 + 8)
      ? 'down'
      : spaceAbove > spaceBelow
        ? 'up'
        : 'down';

    return {
      left: rect.left,
      width: rect.width,
      top: direction === 'down' ? rect.bottom + MENU_GAP : rect.top - MENU_GAP,
      direction,
    };
  }, [options.length]);

  /* close on outside click — check both trigger and portal menu */
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  /* close on scroll / resize to prevent stale position */
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    // capture-phase scroll so we catch scrollable parents too
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  /* scroll focused item into view */
  React.useEffect(() => {
    if (!open || focusIdx < 0 || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll<HTMLElement>('[data-dd-option]');
    items[focusIdx]?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open]);

  const openMenu = () => {
    if (disabled) return;
    const pos = computePosition();
    if (!pos) return;
    setMenuPos(pos);
    const idx = options.findIndex((o) => o.value === value);
    setFocusIdx(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const closeMenu = () => setOpen(false);

  const toggle = () => {
    if (open) closeMenu();
    else openMenu();
  };

  const selectOption = (opt: DarkDropdownOption) => {
    onChange?.(opt.value);
    closeMenu();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) {
          openMenu();
        } else if (focusIdx >= 0 && focusIdx < options.length) {
          selectOption(options[focusIdx]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          openMenu();
        } else {
          setFocusIdx((prev) => (prev < options.length - 1 ? prev + 1 : prev));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open) {
          setFocusIdx((prev) => (prev > 0 ? prev - 1 : 0));
        }
        break;
      case 'Tab':
        if (open) closeMenu();
        break;
      default:
        break;
    }
  };

  /* ── portal menu rendered into document.body ── */
  const menu =
    open && menuPos
      ? ReactDOM.createPortal(
          <div
            ref={menuRef}
            className={`${styles.ddMenu} ${menuPos.direction === 'up' ? styles.ddMenuUp : ''}`}
            role="listbox"
            aria-activedescendant={focusIdx >= 0 ? `${id ?? 'dd'}-opt-${focusIdx}` : undefined}
            style={{
              position: 'fixed',
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: MENU_MAX_HEIGHT,
              ...(menuPos.direction === 'down'
                ? { top: menuPos.top }
                : { bottom: window.innerHeight - menuPos.top }),
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isFocused = i === focusIdx;
              return (
                <div
                  key={opt.value}
                  id={`${id ?? 'dd'}-opt-${i}`}
                  data-dd-option
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.ddOption} ${isSelected ? styles.ddOptionSelected : ''} ${isFocused ? styles.ddOptionFocused : ''}`}
                  onMouseEnter={() => setFocusIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt);
                  }}
                >
                  {opt.label}
                  {isSelected && (
                    <svg className={styles.ddCheck} width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
                      <path d="M1 5.5L4.5 9L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      className={`${styles.ddRoot} ${open ? styles.ddOpen : ''} ${disabled ? styles.ddDisabled : ''}`}
      id={id}
    >
      {/* trigger — looks exactly like a text input */}
      <button
        ref={triggerRef}
        type="button"
        className={styles.ddTrigger}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      >
        <span className={selectedOption ? styles.ddTriggerText : styles.ddTriggerPlaceholder}>
          {selectedOption?.label ?? placeholder}
        </span>
        <svg
          className={styles.ddChevron}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu}
    </div>
  );
};

export default DarkDropdown;
