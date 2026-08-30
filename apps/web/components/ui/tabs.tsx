'use client';

import { useState } from 'react';

interface TabsProps {
  tabs: string[];
  children: React.ReactNode;
}

/**
 * Pestañas del prototipo. El contenido compartido (tabla vacía) se muestra bajo
 * la pestaña activa; la variante es visual mientras no existan datos reales.
 */
export function Tabs({ tabs, children }: TabsProps) {
  const [active, setActive] = useState(0);

  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            role="tab"
            aria-selected={index === active}
            className={`tab${index === active ? ' active' : ''}`}
            onClick={() => setActive(index)}
          >
            {tab}
          </button>
        ))}
      </div>
      {children}
    </>
  );
}
