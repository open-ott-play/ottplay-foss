# Inherited player code: source and permission record

Reviewed on 2026-09-12. This records evidence, not a grant of additional rights.
The native font/library changes do not resolve permission for inherited player
code. They also do not imply that the whole player must be rewritten.

## What the repository establishes

- [90502f5](https://github.com/open-ott-play/ottplay-foss/commit/90502f51ab33a51d367178ce39ee013980354fe4)
  introduced only the root MIT license, naming open-ott-play in 2026.
- [64452d1](https://github.com/open-ott-play/ottplay-foss/commit/64452d1cff2aef910f65357f123d12fcfad703ea)
  imported the public project with core, keyhandler and provider excluded.
- [afa5608](https://github.com/open-ott-play/ottplay-foss/commit/afa5608b6c13371e37382676a428a9f997ec7c93)
  subsequently added those three TypeScript modules. Its description says they
  are fully open source; that description does not identify an original-author
  license or permission covering the inherited implementation.
- [The core source](../src/core/index.ts) identifies itself as a port of
  `stb/core.js`. Other player modules identify behavior ported from
  `stbPlayer.js`. The inspected legacy reference headers do not supply a license.
  No original-author permission document was found in the reviewed repository
  history and local reference material.

These facts establish an import history. They do not prove that permission does
not exist outside the repository, identify every original contributor, or decide
whether any particular passage requires permission.

## Relevant primary upstream statement

The earlier OTT-play FOSS maintainer, `prog4food`, explains on
[the project's FOSS page](https://ottp.eu.org/www/foss/) that its name uses
“Free and Open for Society,” that some components are published as source, and
that its additions were made around a publicly available compilation of the
original player. The page distinguishes those additions from original components.
This helps explain provenance, but does not give this repository an MIT grant for
the original player. The original `ott-play.com` site did not expose a usable
license statement in this review. Unrelated services with similar names are not
licensing evidence for this code.

## Evidence needed before a distribution decision

1. Identify the original source or compiled release used for each inherited
   module, including a version/date and a preserved copy or hash.
2. Locate the original author's applicable license, or written permission that
   covers modification and redistribution in the proposed app. Record any
   attribution, source-disclosure or other conditions and their scope.
3. Distinguish original components, the earlier maintainer's additions, and this
   project's own contributions. Do not treat one component's license as a grant
   for the other components.
4. If a specific imported component lacks the necessary grant, resolve that
   component through permission or an independently implemented replacement.
   A repository-wide rewrite is not inferred from incomplete evidence.

No author or maintainer has been contacted as part of this review. No blanket
copyright clearance or infringement conclusion is asserted. Google Play's
[intellectual-property policy](https://support.google.com/googleplay/android-developer/answer/9888072)
requires the publisher to hold the necessary rights; it does not turn an automated
build or a public source repository into proof of those rights.
