# Files

#32, the crm-files lane (31 October 2026): a record's own files, on its page's Files tab and the side panel's.

## Files tab (FilesTab)

- **Purpose**: the files that belong to this record (a proposal, a contract, a photo).
- **Main task**: drop or pick files to add them, then open, download or delete one (Undo brings it back).
- **Leaves out**: folders, document previews, versions, files over 4 MB, and the files a `file` field holds (they stay in their field).

- Read through `data.files.forRecord` (the store loads in its own chunk; the route loader and the panel's `openPeek` open it, so the tab's count arrives with the page), shown with `useRecordFiles` and counted with `useRecordFileCount`.
- Someone who may change the record sees the library's FileDrop first (PDF, images, text and Office files, 4 MB each; several at once), each file then in a FileItem with its progress, and in the list once it lands. A refused one stays with the server's sentence until its × dismisses it. Nobody else sees the drop zone; with no files they see "No files yet".
- Each file: its type icon, its name (a link that opens in a new tab: an image shows, anything else downloads), its size, who added it and when (RelativeTime). A trashed or lost record shows its files read only.
- Delete is one click (owner rule: Undo over confirm): the file leaves at once, "Deleted Proposal.pdf." offers Undo for 10 seconds, and a refusal puts the file back with a toast.
- Live: a `files` event naming the record reads the tab again in every other tab (this tab's own echo is skipped).
- Every string is in `strings.ts`.
