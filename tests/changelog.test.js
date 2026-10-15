import { test } from "node:test";
import assert from "node:assert/strict";
import { changelogRelease } from "../scripts/changelog.js";

test("release notes select the exact package version and exclude older releases", () => {
  const text =
    "# 0.4.20\n\n- Future release\n\n# 0.4.2\n\n- automatic publish\n\n# 0.1.0\n\n- Older changes\n";
  assert.deepEqual(changelogRelease(text, "0.4.2"), {
    title: "0.4.2",
    body: "- automatic publish\n",
  });
});

test("release notes preserve subheadings and code fences while supporting dated version headings", () => {
  const text =
    "# Changelog\r\n\r\n## [v1.2.3] - 2026-10-15\r\n\r\n### Fixed\r\n\r\n- Release upload\r\n\r\n```markdown\r\n# 9.9.9\r\n```\r\n\r\n## 1.2.2\r\n\r\n- Earlier\r\n";
  assert.deepEqual(changelogRelease(text, "1.2.3"), {
    title: "[v1.2.3] - 2026-10-15",
    body: "### Fixed\n\n- Release upload\n\n```markdown\n# 9.9.9\n```\n",
  });
});

test("publishing refuses missing or empty changelog versions", () => {
  assert.throws(
    () => changelogRelease("# 0.4.20\n\n- Other version", "0.4.2"),
    /no release heading.*0\.4\.2/,
  );
  assert.throws(
    () => changelogRelease("# 0.4.2\n\n# 0.1.0\n\n- Old", "0.4.2"),
    /no release notes/,
  );
  assert.throws(
    () => changelogRelease("```\n# 0.4.2\n- Example\n```", "0.4.2"),
    /no release heading/,
  );
});
