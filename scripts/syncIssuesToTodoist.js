require("dotenv").config();
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const GITHUB_USERNAME = "ainstarc";
const GITHUB_TOKEN = process.env.REPO_READ_TOKEN;
const TODOIST_TOKEN = process.env.TODOIST_TOKEN;
const TODOIST_PROJECT_NAME = "GitHub";
const SYNC_FILE = path.resolve(__dirname, ".last-sync.json");

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
    console.log(`📦 Fetched ${json.length} repositories`);
    return json;
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

  if (!res.ok) {
    const errorText = await res.text();
    console.error(
      `❌ Failed to fetch issues for ${repo}: ${res.status} ${res.statusText}`
    );
    console.error(`🔎 Response: ${errorText}`);
    return []; // return empty array so it's still iterable
  }

  const data = await res.json();
  console.log(`🔍 ${repo}: ${data.length} issue(s) fetched`);
  return data;
}

async function getTodoistProjects() {
  const res = await fetch("https://api.todoist.com/rest/v2/projects", {
    headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
  });
  const projects = await res.json();
  //   console.log("🗂️ Available Todoist Projects:");
  //   projects.forEach((p) => console.log(`  - ${p.name} (id: ${p.id})`));
  return projects;
}

async function getTodoistSections(projectId) {
  const res = await fetch(
    `https://api.todoist.com/rest/v2/sections?project_id=${projectId}`,
    {
      headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
    }
  );
  const data = await res.json();
  console.log(`📁 Found ${data.length} section(s) in project ${projectId}`);
  return data;
}

async function createSectionIfNotExists(projectId, repo) {
  const sections = await getTodoistSections(projectId);
  const existing = sections.find(
    (sec) => sec.name.toLowerCase() === repo.toLowerCase()
  );

  if (existing) {
    console.log(`✅ Section '${repo}' already exists`);
    return existing.id;
  }

  console.log(`➕ Creating new section: ${repo}`);
  const res = await fetch("https://api.todoist.com/rest/v2/sections", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: repo,
      project_id: projectId,
    }),
  });

  const newSection = await res.json();
  console.log(`✅ Section '${repo}' created with ID ${newSection.id}`);
  return newSection.id;
}

async function createTodoistTask(title, url, repo, projectId, sectionId) {
  const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: title,
      description: `GitHub: ${url}`,
      project_id: projectId,
      section_id: sectionId,
    }),
  });

  if (!res.ok) {
    console.error(
      `❌ Failed to create task '${title}' in section '${repo}': ${await res.text()}`
    );
  } else {
    console.log(`📝 Created task: '${title}' in section '${repo}'`);
  }
}

(async () => {
  try {
    const lastSync = getLastSyncTime();
    console.log("🔄 Starting sync process...");
    const now = new Date().toISOString();

    if (lastSync) {
      console.log(`🕒 Last sync was at ${lastSync}`);
    } else {
      console.log("🕒 No last sync found, syncing all open issues");
    }

    const projects = await getTodoistProjects();
    const project = projects.find(
      (p) => p.name.toLowerCase() === TODOIST_PROJECT_NAME.toLowerCase()
    );

    if (!project)
      throw new Error(
        `🚫 Todoist project '${TODOIST_PROJECT_NAME}' not found.`
      );

    console.log(
      `📌 Using Todoist Project: ${project.name} (ID: ${project.id})`
    );

    const repos = await getRepos();

    const IGNORED_REPOS = [
      "Quizapp",
      "Assignment"
    ];

    for (const repo of repos) {
      if (IGNORED_REPOS.includes(repo.name)) {
        console.log(`🚫 Skipping ignored repo: ${repo.name}`);
        continue;
      }

      console.log(`\n🔧 Processing repo: ${repo.name}`);
      const issues = await getIssues(repo.name, lastSync);

      if (!Array.isArray(issues)) {
        console.warn(
          `⚠️ Skipping repo '${repo.name}' — issues response invalid`
        );
        continue;
      }

      const sectionId = await createSectionIfNotExists(project.id, repo.name);

      for (const issue of issues) {
        if (
          !issue.pull_request &&
          new Date(issue.created_at) > new Date(lastSync || 0)
        ) {
          console.log(`➡️  Adding issue: "${issue.title}"`);
          await createTodoistTask(
            issue.title,
            issue.html_url,
            repo.name,
            project.id,
            sectionId
          );
        } else {
          console.log(`⏭️ Skipping old or PR issue: "${issue.title}"`);
        }
      }
    }

    setLastSyncTime(now);
    console.log("\n✅ Sync complete.");
  } catch (err) {
    console.error("❌ Error syncing issues:", err);
    process.exit(1);
  }
})();
