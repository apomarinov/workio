# Release

Create a new versioned release by tagging the latest commit and updating the changelog.

## Steps

1. **Find the latest tag** — run `git tag --sort=-creatordate | head -1` to get the current version.

2. **List all commits since that tag** — run `git log <latest-tag>..HEAD --oneline` and `git diff --stat <latest-tag>..HEAD | tail -5` to see the full scope of changes.

3. **Determine the new version** — based on the number and nature of changes:
   - **Patch** (v0.2.0 → v0.2.1): only bug fixes, minor tweaks
   - **Minor** (v0.2.0 → v0.3.0): new features, significant improvements
   - **Major** (v0.2.0 → v1.0.0): breaking changes, major milestones

4. **Update CHANGELOG.md** — add a new entry at the top (below the `# Changelog` heading) following the existing format:
   ```
   ## [vX.Y.Z](../../compare/vPREV...vX.Y.Z) — YYYY-MM-DD

   ### Features
   - ...

   ### Improvements
   - ...

   ### Bug Fixes
   - ...
   ```
   - Categorize every commit into Features, Improvements, or Bug Fixes.
   - Group related commits into single bullet points where appropriate.
   - Omit empty sections.
   - Use today's date.

5. **Commit the changelog** — stage and commit with message `Add vX.Y.Z changelog entry`.

6. **Tag the new commit** — run `git tag vX.Y.Z` on the changelog commit.

7. **Push everything** — run `git push && git push --tags`.
