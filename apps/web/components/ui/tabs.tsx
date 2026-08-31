'use client';

import { useState } from 'react';

interface TabsProps {
  tabs: string[];
  children: React.ReactNode | ((activeTab: number) => React.ReactNode);
  activeTab?: number;
  onChange?: (index: number) => void;
}

/**
 * Pestañas operativas. Puede usarse controlada (activeTab + onChange) o no
 * controlada; el children puede ser una función que recibe la pestaña activa.
 */
export function Tabs({ tabs, children, activeTab, onChange }: TabsProps) {
  const [internalActive, setInternalActive] = useState(0);
  const active = activeTab ?? internalActive;
  const setActive = (index: number) => {
    setInternalActive(index);
    onChange?.(index);
  };

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
      {typeof children === 'function' ? children(active) : children}
    </>
  );
}
