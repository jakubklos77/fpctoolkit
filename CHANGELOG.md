## [1.2.7] - 2025-04-30
## add:
- FPC Error 5088 handled as a Warning not to hide the primary error
- Jump to next and previous indentation block support - Ctrl+Shift+[ and Control+Shift+]
## fix:
- Rename vs unsaved document fixed
- Problem match - order of units preserved

## [1.2.6] - 2025-04-28
## add:
- FPC project - project files (tabs, positions) saved and restored on project activation
- Context menu - "Main source" support
- .lpi HostApplication support added
- "cwd" support for Target if local or MainFile

## [1.2.5] - 2025-04-22
## add:
- fpctoolkit.project.rebuild can be called with a shortcut (Shift+F9) - does not need a need to be called from
- editor commands (fpctoolkit.editor.): base64encode, base64decode, hexencode, hexdecode, urlencode, urldecode, quoted-printable decode
- ctrl+shift+g Generate UUID
## fix:
- activate project - reloadTasks no longer work (used async call), client reloaded now
- refactor rename - support for all units
- references - support for all units
- fpctoolkit.code.rename - does not await (first issues rename then SaveAll), fixes the focus vs Home issue...

## [1.2.4] - 2025-04-15
## fix:
- more indentation rules
- snippets updated

## [1.2.3] - 2025-04-09
## add:
- problem matcher - Hints supported as well
- problem matcher - IDE jumps to the first error in the code
- syntax error checks - better format like in Lazarus/FPC

## [1.2.2] - 2025-04-09
## add:
- double click to activate a project
- delete to first word (Ctrl+T) 100% like Lazarus
## fix:
- "rename" F2 and "delete to first word" Ctrl+T - commands working even if addon not activated

## [1.2.1] - 2025-04-09
## add:
- go to implementation works with dirty files (unsaved and changed text)
- Ctrl+T - "delete to first word" - works like in Lazarus IDE
- startup speed greatly enhanced (starts in 1 sec now)

## [1.2.0] - 2025-04-09
## add:
- Lazarus .lpi project support
- lazbuild tasks
- project management
## fix:
- problem matcher

## [1.1.9] - 2022-12-17
## add:
-  optimize clean up and build
## fixed:
-  can't rename symbol on version 1.1.8

## [1.1.8] - 2022-12-16
## add:
-  add error handle for client to avoid crashing
-  change maximumCompletions default to 50

## [1.1.6] - 2022-12-06
## add:
-  add build events

## [1.1.5] - 2022-11-23
## fixed:
- can't start language server on linux

## [1.1.4] - 2022-10-15
## fixed:
- quick fix not worked

## [1.1.3] - 2022-10-14
### add:
- code format
- quick fix for [5025] Local variable "xxx" not used
- document symbols navigation
- remove ununsed unit
### fixed:
- Enhance the stability of the program pasls

## [1.1.0]
- pascal language server
- code snippets
- auto completion
- gotoDeclaration, gotoDefinition
- references
- documentHighlight
- i18n support

## [1.0.4] - 2020-10-14
### fixed:
- Throw exception when parsing non-fpc type tasks

## [1.0.3] - 2020-10-13
### fixed:
- error with "fs-extra module not found"


## [1.0.2] - 2020-10-12
### add:
- Clean menu


## [1.0.1] - 2020-09-17
### fixed:
- Fixes for issues that don't work under Linux

## [1.0.0] - 2020-09-17
- Initial release