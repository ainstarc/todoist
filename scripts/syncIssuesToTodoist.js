require("dotenv").config();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const GITHUB_USERNAME = "ainstarc";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TODOIST_TOKEN = process.env.TODOIST_TOKEN;
const TODOIST_PROJECT_NAME = "GitHub";
const SYNC_FILE = path.resolve(__dirname, ".last-sync.json");

const SELECTED_PUBLIC_REPOS = [
  ".github",
  "bingo-game",
  "Countdown",
  "encryption-hub",
  "garments-site",
  "garments-studio",
  "git-init",
  "git-init-api",
  "Guess-the-Roll",
  "ipo-gmp",
  "ipo-gmp-backend",
  "pixel-realm",
  "the-ain-verse",
  "todoist",
];

const REPO_TO_SECTION_MAP = {
  "ipo-gmp": "IPO GMP",
  "ipo-gmp-backend": "IPO GMP",
  "git-init": "GitBot",
  "git-init-api": "GitBot",
  "garments-site": "Garments",
  "garments-studio": "Garments",
  "encryption-hub": "Meta",
  ".github": "Meta",
  "the-ain-verse": "Meta",
  "todoist": "Meta",
  "bingo-game": "Games",
  "Countdown": "Games",
  "Guess-the-Roll": "Games",
  "pixel-realm": "Games",
};

const DEFAULT_SECTION = "Default";

function getLastSyncTime() {
  if (fs.existsSync(SYNC_FILE)) {
    const data = JSON.parse(fs.readFileSync(SYNC_FILE, "utf8"));
    return data.lastSync || null;
  }
  return null;
}

function setLastSyncTime(timestamp) {
  fs.writeFileSync(SYNC_FILE, JSON.stringify({ lastSync: timestamp }, null, 2));
  console.log(`🕒 Updated last sync time to ${timestamp}`);
}

async function getRepos() {
  const res = await fetch("https://api.github.com/user/repos?per_page=100", {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "User-Agent": "GitHub-to-Todoist-Sync",
      Accept: "application/vnd.github+json",
    },
  });

  const text = await res.text();

  try {
    const json = JSON.parse(text);
    if (!res.ok) {
      console.error(`❌ GitHub API error ${res.status}: ${res.statusText}`);
      console.error(`🔍 Response body:\n${text}`);
      return [];
    }

    const filtered = json.filter(
      (repo) =>
        !repo.private &&
        repo.owner.login.toLowerCase() === GITHUB_USERNAME.toLowerCase()
    );

    console.log(`📦 ${filtered.length} public owned repositories found`);
    console.log("🔗 Repositories:", filtered.map((r) => r.name).join(", "));
    return filtered;
  } catch (e) {
    console.error("❌ Failed to parse JSON response from GitHub");
    console.error(text);
    return [];
  }
}

async function getIssues(repo, since) {
  const sinceParam = since ? `&since=${since}` : "";
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/issues?per_page=100${sinceParam}`;

  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });

  if (!res.ok) return [];

  const data = await res.json();
  return data.filter((i) => !i.pull_request);
}

async function getPullRequests(repo) {
  const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${repo}/pulls?state=open&per_page=100`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` },
  });

  if (!res.ok) return [];
  return await res.json();
}

async function getTodoistProjects() {
  const res = await fetch("https://api.todoist.com/rest/v2/projects", {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  return await res.json();
}

async function getTodoistSections(projectId) {
  const res = await fetch(
    `https://api.todoist.com/rest/v2/sections?project_id=${projectId}`,
    { headers: { Authorization: `Bearer ${TODOIST_TOKEN}` } }
  );
  return await res.json();
}

async function createSectionIfNotExists(projectId, sectionName, currentSections) {
  const existing = currentSections.find(
    (s) => s.name.toLowerCase() === sectionName.toLowerCase()
  );
  if (existing) {
    console.log(`✅ Reusing section: ${sectionName}`);
    return existing.id;
  }

  if (currentSections.length >= 20) {
    console.warn(`⚠️ Max section limit reached. Skipping: ${sectionName}`);
    return null;
  }

  const res = await fetch("https://api.todoist.com/rest/v2/sections", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: sectionName, project_id: projectId }),
  });

  const json = await res.json();
  console.log(`➕ Created new section: ${sectionName}`);
  return json.id;
}

async function createTodoistTask(title, url, repo, projectId, sectionId) {
  const payload = {
    content: title,
    description: `GitHub: ${url}\nRepo: ${repo}`,
    project_id: projectId,
  };
  if (sectionId) payload.section_id = sectionId;

  const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.warn(`❌ Failed to create task "${title}" — ${res.status}`);
    return false;
  }
  return true;
}

(async () => {
  try {
    console.log("🔄 Starting sync process...");
    const lastSync = getLastSyncTime();
    const now = new Date().toISOString();

    const projects = await getTodoistProjects();
    const project = projects.find(
      (p) => p.name.toLowerCase() === TODOIST_PROJECT_NAME.toLowerCase()
    );
    if (!project) throw new Error("🚫 Todoist project not found");

    const repos = await getRepos();
    const sections = await getTodoistSections(project.id);
    const sectionNames = [...new Set(Object.values(REPO_TO_SECTION_MAP))];
    sectionNames.push("Pull Requests", DEFAULT_SECTION);

    const sectionIds = {};
    for (const name of sectionNames) {
      sectionIds[name] = await createSectionIfNotExists(
        project.id,
        name,
        sections
      );
    }

    let taskCount = 0;

    for (const repo of repos) {
      const repoName = repo.name;
      const section =
        REPO_TO_SECTION_MAP[repoName] ||
        (SELECTED_PUBLIC_REPOS.includes(repoName) ? repoName : DEFAULT_SECTION);

      const sectionId = sectionIds[section];
      console.log(`\n🔧 Processing "${repoName}" under section "${section}"`);

      const issues = await getIssues(repoName, lastSync);
      console.log(`🔍 Found ${issues.length} issue(s)`);

      for (const issue of issues) {
        if (
          issue.title.trim() ===
          "[Hygiene] Apply README, CHANGELOG, SW, and Post-PR Fixes #1"
        ) {
          console.log(`⚠️ Skipping hygiene issue in ${repoName}`);
          continue;
        }

        const success = await createTodoistTask(
          issue.title,
          issue.html_url,
          repoName,
          project.id,
          sectionId
        );
        if (success) taskCount++;
      }

      const prs = await getPullRequests(repoName);
      console.log(`🔍 Found ${prs.length} pull request(s)`);

      for (const pr of prs) {
        const success = await createTodoistTask(
          `[PR] ${pr.title}`,
          pr.html_url,
          repoName,
          project.id,
          sectionIds["Pull Requests"]
        );
        if (success) taskCount++;
      }
    }

    setLastSyncTime(now);
    console.log(`\n✅ Sync complete. Total tasks created: ${taskCount}`);
  } catch (err) {
    console.error("❌ Error syncing issues:", err);
    process.exit(1);
  }
})();
