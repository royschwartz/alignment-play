// The right two thirds of the middle section: the descriptions (Roy, Oct 11).
// They work as A Dark Room's history does, which the log followed before
// them: the newest goes in at the top with a short linear fade, the rest step
// down at once, and they fade toward the bottom by where they are, never by
// how old they are. Nothing drifts. A line carries no activity (that's on
// the left now) and no "+1 rapture" (Roy, Oct 11: the numbers at the top
// turn instead).
export function createStream(el) {
  const nodes = new Map();
  let first = true;

  function build(line) {
    const p = document.createElement('p');
    p.className = line.italic ? 'line italic' : 'line';
    p.textContent = line.text;
    return p;
  }

  return {
    // lines: oldest first, each { key, text, italic }. still: no entrance fade.
    render(lines, { still = false } = {}) {
      const live = new Set(lines.map(l => l.key));
      for (const [key, node] of nodes) if (!live.has(key)) { node?.remove(); nodes.delete(key); }
      for (const line of lines) {
        let node = nodes.get(line.key);
        if (node === undefined) {
          node = build(line);
          if (!first && !still) node.classList.add('new');
          nodes.set(line.key, node);
          el.prepend(node);
        }
        // null: it has gone below the bottom and was taken off the page.
        if (!node) continue;
        if (node.textContent !== line.text) node.textContent = line.text;
      }
      first = false;
      // Lines wholly below the bottom are gone for good.
      const height = el.clientHeight;
      if (height) for (const [key, node] of nodes) if (node && node.offsetTop > height) { node.remove(); nodes.set(key, null); }
    },
    get count() { return [...nodes.values()].filter(Boolean).length; },
  };
}
