### Objective
Fix `src/pages/IngestionHubPage.tsx` by adding supplier auto-detection logic to the `handleLoadFromUrl` function and ensuring the `workspaceId` is correctly handled.

### Proposed Changes

#### 1. Imports
Add `useWorkspaceContext` to the imports in `src/pages/IngestionHubPage.tsx` to retrieve the current workspace ID.

#### 2. Component Logic
- Initialize `useWorkspaceContext` at the top of the `IngestionHubPage` component.
- Define `workspaceId` as `activeWorkspace?.id`.

#### 3. Supplier Matching Logic in `handleLoadFromUrl`
Modify the `handleLoadFromUrl` function to search for a matching supplier based on the feed URL after a successful load. If a match is found, update the `detectedSupplier` state and show a success toast.

### Technical Details

- **File**: `src/pages/IngestionHubPage.tsx`
- **Hook**: `const { activeWorkspace } = useWorkspaceContext();`
- **Variable**: `const workspaceId = activeWorkspace?.id;`
- **Logic Placement**: After `toast.success(\`Feed carregado: \${data.totalRows} produtos\`);` in `handleLoadFromUrl`.

### Verification Plan
- Confirm `workspaceId` usage in the file.
- Verify the `handleLoadFromUrl` function contains the new logic.
- Show lines 440-465 of the modified file.
