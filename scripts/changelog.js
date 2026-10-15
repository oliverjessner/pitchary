export function changelogRelease(markdown, version) {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const headings = [];
  let fence;
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const heading = lines[index].match(
      /^ {0,3}(#{1,6})[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/,
    );
    if (!heading) continue;
    const title = heading[2];
    const first = title
      .split(/\s/, 1)[0]
      .replace(/^\[(.*)\]$/, "$1")
      .replace(/^v/, "");
    headings.push({
      index,
      level: heading[1].length,
      title,
      version: /^\d+\.\d+\.\d+(?:[-+][\da-z.-]+)*$/i.test(first) ? first : null,
    });
  }
  const selected = headings.findIndex((heading) => heading.version === version);
  if (selected < 0)
    throw new Error(
      `docs/changelog.md has no release heading for package.json version ${version}.`,
    );
  const heading = headings[selected];
  const end =
    headings
      .slice(selected + 1)
      .find((next) => next.version || next.level <= heading.level)?.index ??
    lines.length;
  const body = lines
    .slice(heading.index + 1, end)
    .join("\n")
    .trim();
  if (!body)
    throw new Error(
      `The changelog section for ${version} has no release notes.`,
    );
  return { title: heading.title, body: body + "\n" };
}
