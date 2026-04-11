 Plan: Remove redundant fields + Add TODO collateral CLI commands                           
                                                                                            
 Context                                                                                    
                                                                                            
 The database schema supports collateral features the CLI can't reach. Two denormalized fields   │
 (has_folder, notes_snapshot) add complexity without value. Then we need four new CLI commands   │
 (todo collateral add/remove/list/get) to unblock attaching files to TODOs. Work is done in 
 chunks, each committed separately, TDD-style.                                              
                                                                                            
 ---                                                                                        
 Chunk 1: Remove has_folder from brainy_todos ✅ DONE                                               
                                                                                            
 The has_folder column is never written to and is derivable from collateral rows existing.  
                                                                                            
 Files to modify:                                                                           
 - sql/setup.sql — remove has_folder boolean default false (line 33)                        
 - backend/storage-supabase.js — remove has_folder from listTodos select (line 24) and return    │
 (line 45), and from getTodo return (line 81)                                               
 - backend/cli.js — no changes needed (cli never references has_folder directly; the output()    │
 function doesn't print it)                                                                 
                                                                                            
 Tests: Add a test in a new test/cli-todos.test.js that verifies todo list and todo get output   │
 does NOT include has_folder — both plain text and --format json output. Run tests, confirm
 they fail (mock still returns has_folder), then make the storage changes, confirm tests pass.                                             
                                                                                            
 Migration SQL (to run manually):                                                           
 ALTER TABLE brainy_todos DROP COLUMN IF EXISTS has_folder;                                 
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Chunk 2: Remove notes_snapshot from brainy_archive_entries ✅ DONE                                 
                                                                                            
 The notes_snapshot column is redundant — the same value lives inside todo_snapshot.notes.  
                                                                                            
 Files to modify:                                                                           
 - sql/setup.sql — remove notes_snapshot text (line 155)                                    
 - backend/storage-supabase.js — remove notes_snapshot: todo.notes from archive insert (line
 173)                                                                                       
                                                                                            
 Tests: Add a test in test/cli-todos.test.js (or test/storage-todos.test.js) that verifies  
 archiveTodo does NOT include notes_snapshot in the insert payload. Write test first, confirm    │
 fail, then fix.                                                                            
                                                                                            
 Migration SQL:                                                                             
 ALTER TABLE brainy_archive_entries DROP COLUMN IF EXISTS notes_snapshot;                   
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Chunk 3: todo collateral list <name> ✅ DONE                                                       
                                                                                            
 Show collateral with content_type and text/binary indicator (richer than current todo get which │
  only shows filenames).                                                                    
                                                                                            
 Files to modify:                                                                           
 - backend/storage-supabase.js — add listCollateral(todoName) function: look up todo by name,
 then select `filename, content_type, text_content` from brainy_todo_collateral where todo_id
 matches. Compute is_text in JS: `c.text_content !== null`. Also update the collateral
 sub-query in getTodo (line 66) from `.select('filename')` to
 `.select('filename, content_type, text_content')` and map results to include
 `is_text: c.text_content !== null`. (PostgREST .select() does not support computed columns
 like `text_content is not null as is_text` — must compute in JS.)                
 - backend/cli.js — add todo collateral list <name> route under the todo resource. Output each   │
 row as - filename (content_type) [textbinary].                                            
 - Export listCollateral from storage-supabase.js.                                          
                                                                                            
 Tests (test/cli-todos.test.js): Test CLI routes to the right storage call, test output format.  │
 Write tests first.                                                                         
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Chunk 4: todo collateral add <name> <filepath> ✅ DONE                                             
                                                                                            
 Upload a file and create a collateral row.                                                 
                                                                                            
 Files to modify:                                                                           
 - backend/storage-supabase.js — add addCollateral(todoName, filepath) function:            
   a. Look up todo by name to get todo.id                                                   
   b. Read file from disk, detect content_type via extension (use a simple map or the mime-types │
  package — check if already a dependency, otherwise use a simple hardcoded map)            
   b2. Add `const fs = require('fs/promises')` and `const path = require('path')` to the top
 of storage-supabase.js. Use `await fs.readFile(filepath)` for Buffer, `await
 fs.readFile(filepath, 'utf-8')` for text content.
   c. If text (content_type starts with text/ or is common text types like application/json,
 application/yaml): read as UTF-8, insert row with text_content                             
   d. If binary: upload to Supabase Storage bucket `brainy_files` using
 `supabase.storage.from('brainy_files').upload(storagePath, fileBuffer)` where storagePath is
 `{userId}/{todoId}/{filename}`. Insert row with storage_path.                                                                          
   e. Return { filename, content_type, is_text }                                            
 - backend/cli.js — add todo collateral add <name> <filepath> route                         
 - Export new function                                                                      
                                                                                            
 Note on has_folder: The FUTURE.md says "Auto-set has_folder = true" but we're removing that
 column in Chunk 1, so we skip this.                                                        
                                                                                            
 Tests: Mock the storage layer (mock-supabase.js needs `upload` and `remove` mocks added to
 the storage chain). Test CLI routing + argument validation. Test that text files go via
 text_content and binary via storage upload.                                            
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Chunk 5: todo collateral remove <name> <filename> ✅ DONE                                          
                                                                                            
 Delete a collateral row and its Storage object if binary.                                  
                                                                                            
 Files to modify:                                                                           
 - backend/storage-supabase.js — add removeCollateral(todoName, filename) function:         
   a. Look up todo by name                                                                  
   b. Fetch the collateral row to check if it has a storage_path                            
   c. If storage_path exists, delete from Supabase Storage                                  
   d. Delete the collateral row                                                             
 - backend/cli.js — add route                                                               
 - Export new function                                                                      
                                                                                            
 Tests: Test CLI routing. Test that storage object is deleted for binary files but not for text  │
 files.                                                                                     
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Chunk 6: todo collateral get <name> <filename> ✅ DONE                                             
                                                                                            
 Print text content or generate a signed download URL.                                      
                                                                                            
 Files to modify:                                                                           
 - backend/storage-supabase.js — add getCollateral(todoName, filename) function:            
   a. Look up todo, then fetch the collateral row (with text_content, storage_path,         
 content_type)                                                                              
   b. If text_content is set, return { filename, content_type, text_content }               
   c. If storage_path is set, generate signed URL (reuse createSignedMediaUrls), return {   
 filename, content_type, url }                                                              
 - backend/cli.js — add route. For text: print content. For binary: print filename          
 (content_type): <signed_url>.                                                              
 - Export new function                                                                      
                                                                                            
 Tests: Test both text and binary paths through CLI.                                        
                                                                                            
 Commit after green tests.                                                                  
                                                                                            
 ---                                                                                        
 Verification ✅ DONE (tests pass, smoke tested list/get against real Supabase)                                                                               
                                                                                            
 After each chunk:                                                                          
 1. npm test — all tests pass                                                               
 2. Manual smoke test against real Supabase — read-only commands only (list, get). Do NOT run
 destructive operations (delete, update) against the real database during smoke testing.
 3. After chunks 1-2, run the migration SQL against the real database                       
                                                                                            
 Key files                                                                                  
                                                                                            
 - backend/storage-supabase.js — all storage CRUD                                           
 - backend/cli.js — CLI routing and output                                                  
 - sql/setup.sql — schema definition                                                        
 - test/cli-captures.test.js — existing test patterns to follow (mock structure, runCLI harness) │
 - test/helpers/mock-supabase.js — Supabase chain mock                                      
                                                                                            
 Reusable code                                                                              
                                                                                            
 - createSignedMediaUrls() in storage-supabase.js (line 417) — reuse for signed URLs in     
 collateral get                                                                             
 - runCLI() test harness from test/cli-captures.test.js — extract or duplicate for todo tests    │
 - CLI routing for collateral: In cli.js main(), add an `else if (action === "collateral")`
 branch inside the `resource === "todo"` block. Destructure rest as `[subAction, ...subRest]`.
 Dispatch on subAction: "list"/"add"/"remove"/"get". For "list" and "get", subRest[0] is
 <name>, subRest[1] is <filename>. For "add", subRest[0] is <name>, subRest[1] is <filepath>.
 For "remove", subRest[0] is <name>, subRest[1] is <filename>.

 ---
 Final Step: Capture Learnings ✅ DONE

 After all chunks are implemented and tests pass, append a "Learnings" section to the bottom
 of this file documenting anything surprising or non-obvious discovered during implementation.
 These notes will be reused as reference when writing future CLI extension plans. Examples of
 what to capture: API gotchas, mock gaps, schema surprises, patterns that worked well.

 ---
 Learnings

 1. **getTodo collateral shape change is a breaking change for output()**: Changing collateral
    from `string[]` to `object[]` broke `data.collateral.join(', ')` in the CLI output function.
    When enriching a field's shape, always grep for all consumers of that field in cli.js output().

 2. **Mock structure in cli-todos.test.js**: The existing test pattern (mock storage at module
    level, runCLI helper that captures stdout/stderr/exitCode) scales well to new commands.
    Adding new storage methods to the mock object upfront avoids re-mocking later.

 3. **PostgREST .select() cannot compute columns**: As noted in the plan, you can't do
    `text_content is not null as is_text` in a PostgREST select. Must compute in JS after fetch.

 4. **Content type detection**: No `mime-types` dependency existed, so a hardcoded map was used.
    The map covers common text and binary types. If mime detection needs to be richer later,
    consider adding the `mime-types` npm package.

 5. **Signed URL field name**: Supabase JS client returns `signedUrl` (camelCase) in v2. The
    code handles both `signedUrl` and `signedURL` defensively.

 6. **Storage remove() takes an array**: `supabase.storage.from().remove()` expects an array of
    paths, not a single string. Easy to miss.

 7. **Mock supabase storage needs upload/remove**: The mock-supabase.js helper only had
    `createSignedUrls`. For full collateral testing at the storage layer (not just CLI routing),
    `upload` and `remove` mocks would need to be added to the storage chain builder.    