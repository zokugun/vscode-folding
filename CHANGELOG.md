# Changelog

## 0.18.0 | 2021-07-20
- fix capture groups in nested rules
- `endRegex` with refs are generated on the run
- update icon

## 0.17.0 | 2021-07-15
- add API to support external rules

## 0.16.0 | 2021-07-03
- fix indented languages by avoiding to define the folding provider
- add the configuration `explicitFolding.wilcardExclusions`

## 0.15.0 | 2021-07-03
- add the configuration `explicitFolding.autoFold` to automatically fold ranges when opening a file

## 0.14.8 | 2021-06-25
- fix new conflict between rules when `foldLastLine` and `nested` are `false`
- better explanation of `consumeEnd` in the doc

## 0.14.7 | 2021-06-25
- fix how to calculate next offset
- fix consumeEnd with begin and end on same line
- exit secondary loop at the end of the match, not at the next line

## 0.14.6 | 2021-06-25
- manually published on Visual Studio Marketplace

## 0.14.5 | 2021-06-24
- fix issue with repeated `"strict": "never"`
- change icon

## 0.14.4 | 2021-06-21
- fix conflict between rules when `foldLastLine` and `nested` are `false`
- add icon

## 0.14.3 | 2021-06-20
- fix infinity loop with single-line and not-nested region

## 0.14.2 | 2021-06-18
- fix global `explicitFolding.rules`

## 0.14.1 | 2021-06-18
- fix how to determine that the configuration `folding` isn't used

## 0.14.0 | 2021-06-18
- rename the configuration `folding` to `explicitFolding.rules` (`folding` is supported until July 1, 2022)
- rename the configuration `startupDelay` to `explicitFolding.delay`
- the configurations `explicitFolding.rules`, `explicitFolding.debug` or `explicitFolding.delay` can be placed in a language section.
- the property `descendants` is regrouped with the property `nested`
- the `begin/end` rule is fully supporting the property `nested` as an array of rules
- add `begin/while` rule
- add `while` rule
- add documentation for each rules and their applicable properties

## 0.13.1 | 2021-05-18
- fix `^` in the alternative loop for non-nested blocks
- improve debug messages

## 0.13.0 | 2021-05-14
- using deferred provider so that the real folding provider is loaded after the language's folding provider. By doing so, the folding ranges provided by the extension are given an higher importance, so VSCode is using them instead of the ones from the language's folding provider (if there is a conflict).

## 0.12.1 | 2021-05-12
- fix need to reload VSCode when changing `explicitFolding.debug`

## 0.12.0 | 2021-05-12
- add the configuration `explicitFolding.debug` to print out debug informations into the channel `Folding` of the panel `Output`
- add `foldEOF` property which will close the folding at the end of the file
- add `foldBOF` property, only for separators
- add `descendants` property, only for separators
- add `strict` property, only for separators
- `^` is correctly matching the beginning of a line
- use new regex parser to support `(?<=y)x`, `(?<!y)x`, `(?i)x` and `(?i:x)`
- add unit tests

## 0.11.0 | 2021-02-20
- add `indentation` property
- add flag indicating that the extension is managing how to fold the last line (only for [MrCode](https://github.com/zokugun/MrCode))

## 0.10.0 | 2021-02-16
- add dynamic `foldLastLine`

## 0.9.2 | 2021-02-12
- register provider to all applicable schemes

## 0.9.1 | 2020-12-24
- allows provider on all schemes
- fix README

## 0.9.0 | 2020-08-20
- add the configuration `explicitFolding.startupDelay` which will delay the registration of the folding providers when starting up (1000ms by default). It's fixing the issue when the editor wasn't using the correct foldings at startup.
- add the configuration `explicitFolding.notification` to manage the notifications. By default, the notifications will be shown only for minor revisions

## v0.8.2 | 2020-05-27
- fix `continuation` marker when first match doesn't include the line-continuation character
- fix looping on configuration

## v0.8.1 | 2020-05-26
- improve handling of non-nested rules to test only necessary regexes

## v0.8.0 | 2020-05-26
- add `continuation` marker
- fix infinity loop due to zero-length regexes
- fix capturing groups

## v0.7.1 | 2020-05-22
- add `nested` property

## v0.7.0 | 2020-05-12
- support docstring blocks

## v0.6.0 | 2020-04-14
- add `separator` property

## v0.5.1 | 2020-03-20
- fix missing dependency

## v0.5.0 | 2020-03-20
- support capturing groups
- fix known issue only for [MrCode](https://github.com/zokugun/MrCode)

## v0.4.0 | 2020-03-18
- fix bug when `begin` and `end` markers are on the same line
- add `middle` marker
- add `foldLastLine` property
- add `kind` property to indicate if the range is a `comment` or a `region`

## v0.3.2 | 2019-06-08
- show message when the extension is updated
- update dependencies due to security issue

## v0.3.1 | 2019-04-04
- catch error due to bad regexes

## v0.3.0 | 2019-04-03
- change configuration's properties `begin` and `end` as regular string (**not regex**)
- add configuration's properties `beginRegex` and `endRegex` to be able to use **regex**

## v0.2.1 | 2018-07-18
- rename repository

## v0.2.0 | 2018-07-18
- rename extension
- support multiple markers for a language
- rename configuration's property `start` to `begin`

## v0.1.1 | 2018-07-16
- fix error in settings
- update foldings on configuration changes
- fix formatting

## v0.1.0 | 2018-07-09
- Initial release
