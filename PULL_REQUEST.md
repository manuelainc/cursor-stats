# Fix for "No token found" error with large database files

## Problem Description

The Cursor Stats extension shows a "No token found" error with large databases (>2GB) because it uses `sql.js`, which loads the entire file into memory through `fs.readFileSync()`. On macOS, especially on Apple Silicon machines, the `state.vscdb` file can easily exceed 2GB (in our case it reached 2.77GB), causing an `ERR_FS_FILE_TOO_LARGE` error when trying to load the entire file into memory.

## Solution

This PR replaces the use of `sql.js` with `sqlite3`, which can handle large database files without loading them completely into memory. The implementation:

1. Uses `sqlite3` as the primary library to access the database
2. Keeps `sql.js` as a fallback only for small files (less than 1.5GB)
3. Imports dependencies dynamically to avoid compilation problems
4. Adds more logging information about the database file size
5. Improves error handling and feedback in case of problems

## Testing

This solution has been tested on:
- macOS with databases larger than 2.5GB
- Confirms that it can correctly access the authentication token

## Changes

- Added `sqlite3` as a dependency
- Modified `src/services/database.ts` to use sqlite3 instead of sql.js
- Maintained backward compatibility with existing sql.js logic
- Added file size verification to optimize database access strategy

## Note

This change resolves the issue while maintaining existing functionality and should not negatively affect users who don't experience the problem. 