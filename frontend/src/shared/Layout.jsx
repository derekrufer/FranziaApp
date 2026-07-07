import React from "react";

export function TopNavigation({ pages, selectedPage, onSelectPage }) {
  return (
    <nav className="top-nav" aria-label="Primary navigation">
      {pages.map((page) => (
        <button
          key={page.id}
          className={selectedPage === page.id ? "active" : ""}
          onClick={() => onSelectPage(page.id)}
          type="button"
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}

export function CommissionerTabs({ tabs, activeTabId, onSelectTab }) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) {
    return null;
  }

  return (
    <div className="commissioner-tabs">
      <nav className="commissioner-tab-list" aria-label="Commissioner sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab.id ? "active" : ""}
            onClick={() => onSelectTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="commissioner-tab-panel">{activeTab.content}</div>
    </div>
  );
}
