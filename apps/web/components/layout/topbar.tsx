'use client';

import {
  HamburgerMenuIcon,
} from '@radix-ui/react-icons';

interface TopbarProps {
  onOpenMenu:
    () => void;
}

export function Topbar({
  onOpenMenu,
}: TopbarProps) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="mobile-menu"
        onClick={
          onOpenMenu
        }
        aria-label="Abrir menú"
      >
        <HamburgerMenuIcon
          width={18}
          height={18}
        />
      </button>
    </header>
  );
}
