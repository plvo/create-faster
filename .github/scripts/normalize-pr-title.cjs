const PATTERNS = [
  // FEAT
  { regex: /^(?:Feat|Feature|FT|feat|feature|ft)[\s/\\|:-]+(.+)$/i, type: 'feat' },
  { regex: /^(?:new|Update|update|updated|Updated|add|adding|added)\s+(.+)$/i, type: 'feat' },
  { regex: /^(?:Fix|Bug|Bugfix|Hotfix|Patch|fix|bug|bugfix|hotfix|patch)[\s/\\|:-]+(.+)$/i, type: 'fix' },
  { regex: /^(?:resolve|resolves|resolved|solve|solves|solved)\s+(.+)$/i, type: 'fix' },
];

function normalize(title) {
  if (/^[a-z]+(?:\([^)]+\))?\s*!?\s*:\s*.+$/.test(title)) {
    return { normalized: title, changed: false };
  }

  const cleanTitle = title.trim().replace(/\s+/g, ' ');
  if (!cleanTitle) return { normalized: title, changed: false };

  const isBreaking = /breaking[\s-]change|major[\s-]change|(?:!|⚠️|💥)\s*$|^[^:]+!\s*:/.test(cleanTitle);

  for (const { regex, type } of PATTERNS) {
    const match = regex.exec(cleanTitle);
    if (match) {
      const content = match[1]?.trim() || '';
      if (!content) continue;

      const normalized = `${type}${isBreaking ? '!' : ''}: ${content}`;
      return { normalized, changed: true };
    }
  }

  if (cleanTitle.length > 3 && !cleanTitle.includes(':')) {
    return {
      normalized: `chore${isBreaking ? '!' : ''}: ${cleanTitle}`,
      changed: true,
    };
  }

  return { normalized: title, changed: false };
}

module.exports = async ({ github, context, core }) => {
  const pr = context.payload.pull_request;
  const originalTitle = pr.title;

  console.log(`🔍 Processing PR #${pr.number}: "${originalTitle}"`);

  const { normalized, changed } = normalize(originalTitle);

  if (!changed) {
    console.log('✅ Title already normalized');
    return;
  }

  console.log(`🔄 Normalizing: "${originalTitle}" → "${normalized}"`);

  try {
    // Update PR title
    await github.rest.pulls.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pr.number,
      title: normalized,
    });

    // Add comment
    await github.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pr.number,
      body: `🤖 **PR title normalized for conventional commits**
  
  **Before:** \`${originalTitle}\`  
  **After:** \`${normalized}\`
  
  This helps with automated changelog generation and semantic versioning.`,
    });

    console.log('✅ PR title normalized successfully');
  } catch (error) {
    core.setFailed(`Error normalizing PR title: ${error.message}`);
  }
};
