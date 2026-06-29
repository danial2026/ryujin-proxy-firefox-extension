(function() {
  'use strict';

  async function loadChangelog() {
    try {
      const response = await fetch(browser.runtime.getURL('CHANGELOG.md'));
      if (!response.ok) throw new Error('Failed to fetch');
      return await response.text();
    } catch (e) {
      console.warn('Failed to load changelog:', e);
      return '# Changelog\n\nUnable to load changelog.';
    }
  }

  function parseChangelog(markdown) {
    const lines = markdown.split('\n');
    let currentVersion = null;
    let currentDate = null;
    let changes = [];
    let currentChangeType = null;
    const versions = [];

    lines.forEach(line => {
      const versionMatch = line.match(/^##\s*\[(.+?)\]\s*-\s*(.+)$/);
      if (versionMatch) {
        if (currentVersion) {
          versions.push({ version: currentVersion, date: currentDate, changes });
        }
        currentVersion = versionMatch[1];
        currentDate = versionMatch[2];
        changes = [];
        currentChangeType = null;
        return;
      }

      const changeMatch = line.match(/^###\s*(Added|Changed|Fixed|Removed)$/);
      if (changeMatch) {
        currentChangeType = changeMatch[1].toLowerCase();
        return;
      }

      const itemMatch = line.match(/^-\s*(.+)$/);
      if (itemMatch && currentChangeType) {
        changes.push({ type: currentChangeType, text: itemMatch[1] });
      }
    });

    if (currentVersion) {
      versions.push({ version: currentVersion, date: currentDate, changes });
    }

    return versions;
  }

  function renderChangelog(versions) {
    const container = document.getElementById('changelogContent');
    container.innerHTML = '';

    versions.forEach(({ version, date, changes }) => {
      const versionDiv = document.createElement('div');
      versionDiv.className = 'changelog-version';

      const headerDiv = document.createElement('div');
      headerDiv.className = 'changelog-header';

      const versionTag = document.createElement('span');
      versionTag.className = 'changelog-version-tag';
      versionTag.textContent = `v${version}`;

      const dateSpan = document.createElement('span');
      dateSpan.className = 'changelog-date';
      dateSpan.textContent = date;

      headerDiv.appendChild(versionTag);
      headerDiv.appendChild(dateSpan);
      versionDiv.appendChild(headerDiv);

      const changesList = document.createElement('ul');
      changesList.className = 'changelog-changes';

      const grouped = {};
      changes.forEach(c => {
        if (!grouped[c.type]) grouped[c.type] = [];
        grouped[c.type].push(c.text);
      });

      ['added', 'changed', 'fixed', 'removed'].forEach(type => {
        if (grouped[type]) {
          grouped[type].forEach(text => {
            const li = document.createElement('li');
            li.className = type;
            li.textContent = text;
            changesList.appendChild(li);
          });
        }
      });

      versionDiv.appendChild(changesList);
      container.appendChild(versionDiv);
    });
  }

  async function init() {
    const markdown = await loadChangelog();
    const versions = parseChangelog(markdown);
    renderChangelog(versions);
  }

  init();
})();