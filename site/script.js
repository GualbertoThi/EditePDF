(() => {
  const config = window.EDITEPDF_CONFIG || {};
  const github = config.githubUrl || "#";
  const issues = config.issuesUrl || github;
  ["github-nav", "github-hero", "github-bottom"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.href = github;
  });
  const issuesElement = document.getElementById("issues-bottom");
  if (issuesElement) issuesElement.href = issues;
})();
