# GitHub Issues to Todoist Sync

This project syncs your GitHub issues to Todoist as tasks, organized by repository. It is designed to help you track your GitHub issues directly in your Todoist workspace.

## Features

- Fetches all repositories for a configured GitHub user
- Syncs new issues (not pull requests) to a specified Todoist project
- Creates a Todoist section for each repository (if not already present)
- Adds each new issue as a Todoist task with a link to the GitHub issue
- Maintains a `.last-sync.json` file to avoid duplicate tasks

## Setup

1. **Clone this repository**
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Environment Variables:**
   Create a `.env` file in the root directory with the following:

   ```env
   GITHUB_TOKEN=your_github_token
   TODOIST_TOKEN=your_todoist_token
   ```

   - `GITHUB_TOKEN`: A GitHub personal access token with `repo` scope
   - `TODOIST_TOKEN`: A Todoist API token (from https://todoist.com/prefs/integrations)

4. **Configure Todoist:**
   - Create a Todoist project named `GitHub` (or change the name in the script if desired)

## Usage

### Manual Sync

Run the sync script manually:

```sh
npm run sync
```

### GitHub Actions (Automated)

This project includes a GitHub Actions workflow (`.github/workflows/sync-issues.yml`) that runs the sync every day at 9 AM IST, or on manual dispatch. It requires the following secrets in your repository settings:

- `GITHUB_TOKEN` (automatically available in GitHub Actions)
- `TODOIST_TOKEN` (add this manually)

## File Structure

- `scripts/syncIssuesToTodoist.js` — Main sync script
- `scripts/.last-sync.json` — Stores the last sync timestamp

## Notes

- Only issues created since the last sync are added as tasks
- Pull requests are ignored
- The script is idempotent and safe to run multiple times

## License

MIT
