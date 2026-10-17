# Changelog

## [1.6.9](https://github.com/plvo/create-faster/compare/create-faster-v1.6.8...create-faster-v1.6.9) (2026-10-17)


### Bug Fixes

* **blueprints:** repair the shell of the four dashboards ([#385](https://github.com/plvo/create-faster/issues/385)) ([c206c9b](https://github.com/plvo/create-faster/commit/c206c9b9c92b9e286d25aca5e4a9704ff9103bf2))
* **blueprints:** saas member removal, role-gated write actions, 404 ([#388](https://github.com/plvo/create-faster/issues/388)) ([1e03a33](https://github.com/plvo/create-faster/commit/1e03a33de9d4606b4d9fd1a7de9bce8e3c1f1f5e))
* **blueprints:** serve the blog from the bundle on a Worker ([#393](https://github.com/plvo/create-faster/issues/393)) ([b2acb09](https://github.com/plvo/create-faster/commit/b2acb0968a8ab73b78afa653968506cd57f509b0))
* **blueprints:** surface and map errors of dashboard mutations ([#384](https://github.com/plvo/create-faster/issues/384)) ([6b4076b](https://github.com/plvo/create-faster/commit/6b4076b4c3242b068d40638c2156f8bac43ec186))
* **cli:** polish interactive prompts, help and redirected output ([#391](https://github.com/plvo/create-faster/issues/391)) ([1585f75](https://github.com/plvo/create-faster/commit/1585f75e431609c1e23b64ea2b7474f381d593db))
* **cli:** print only the steps the project can run ([#374](https://github.com/plvo/create-faster/issues/374)) ([90d67f2](https://github.com/plvo/create-faster/commit/90d67f2a210fe2b2b4c01106c3f2cb1432b8ff97))
* **cloudflare:** document ordered D1 provisioning for every repo type ([#389](https://github.com/plvo/create-faster/issues/389)) ([3aa9bff](https://github.com/plvo/create-faster/commit/3aa9bff3524a9b95e6481411928481d63bd147ae))
* **cloudflare:** document the production URL and first admin ([#394](https://github.com/plvo/create-faster/issues/394)) ([761c4e1](https://github.com/plvo/create-faster/commit/761c4e146ef664c53cb91a8a568492259cce33d8))
* **hono:** run dev in Wrangler on cloudflare so bindings exist ([#382](https://github.com/plvo/create-faster/issues/382)) ([dbb0d2b](https://github.com/plvo/create-faster/commit/dbb0d2bdfff3094c0eb614e6d414243ead29820a))
* **mdx:** serve the Next.js MDX pages on Cloudflare ([#380](https://github.com/plvo/create-faster/issues/380)) ([5eb79bc](https://github.com/plvo/create-faster/commit/5eb79bc0a4a8d6cf0232adff9cb0892e1699a599))
* **nextjs:** apply the Geist fonts through the html element ([#386](https://github.com/plvo/create-faster/issues/386)) ([c036b58](https://github.com/plvo/create-faster/commit/c036b58a73b9a1eecae6bd4e143f6cfc3e790366))
* **ports:** let PORT override the port of every app under turbo ([#396](https://github.com/plvo/create-faster/issues/396)) ([26185f8](https://github.com/plvo/create-faster/commit/26185f8c6b3b9f1f7d3dc30fd72c615c605472b3))
* **shadcn:** make shadcn add work in a turborepo ([#390](https://github.com/plvo/create-faster/issues/390)) ([ef85356](https://github.com/plvo/create-faster/commit/ef853560be9fa9246c48168004904ed8f7a1a50d))
* **templates:** leave third-party ids blank and say where to get them ([#397](https://github.com/plvo/create-faster/issues/397)) ([7c80908](https://github.com/plvo/create-faster/commit/7c80908694bb636fe4f7540b819ae1ae80ca8007))

## [1.6.8](https://github.com/plvo/create-faster/compare/create-faster-v1.6.7...create-faster-v1.6.8) (2026-10-16)


### ⚠ BREAKING CHANGES

* **blueprints:** blueprint names changed, the old names are no longer accepted. dapp-privy -> dapp-privy-nextjs dapp-rainbowkit -> dapp-rainbowkit-nextjs org-dashboard -> org-dashboard-nextjs multitenant-saas -> multitenant-saas-nextjs cloudflare-static-site -> cloudflare-static-site-nextjs cloudflare-fullstack -> cloudflare-fullstack-nextjs showcase -> showcase-nextjs lambda-sst -> lambda-sst-hono lambda-terraform-aws -> lambda-terraform-aws-hono

### Features

* add $when negation, deployment keys for all templates, EnvVar.stacks ([#192](https://github.com/plvo/create-faster/issues/192)) ([8f80701](https://github.com/plvo/create-faster/commit/8f8070145e33f06a499a84c8e21ba3f21d5256d0))
* **blueprints:** add a generic extends field that inherits templates ([#303](https://github.com/plvo/create-faster/issues/303)) ([9bcab65](https://github.com/plvo/create-faster/commit/9bcab65c13b52ea324c84bc34f5f65b2dc10fab4))
* **blueprints:** add contacts and admin pages on TanStack Start ([#317](https://github.com/plvo/create-faster/issues/317)) ([2dc4a04](https://github.com/plvo/create-faster/commit/2dc4a0455ed3a9d8a2ad250f30ddcfc7df4f6bcf))
* **blueprints:** add the org-dashboard-tanstack-start core ([#314](https://github.com/plvo/create-faster/issues/314)) ([07a6034](https://github.com/plvo/create-faster/commit/07a60345a0ddf360bddd689cb4365c1cc6d73cbc))
* **blueprints:** suffix every blueprint name with its main stack ([#297](https://github.com/plvo/create-faster/issues/297)) ([0970360](https://github.com/plvo/create-faster/commit/097036033bf89549e5d3e5b3466eb671295b6be9))
* **cli:** add --version and -V flags ([#355](https://github.com/plvo/create-faster/issues/355)) ([8587cc7](https://github.com/plvo/create-faster/commit/8587cc75bca9c90c497b07d6ca3492ee4213e918))
* **cli:** add --yes and none per category, ask nothing without a terminal ([#292](https://github.com/plvo/create-faster/issues/292)) ([51f060d](https://github.com/plvo/create-faster/commit/51f060dcc0e4b7af4343e85c5f9afd1412e734e1))
* **cli:** print the first-run steps in the summary ([#272](https://github.com/plvo/create-faster/issues/272)) ([f8c2a36](https://github.com/plvo/create-faster/commit/f8c2a367b85c6e608fa6b5460336c57aa6c11083))
* **cloudflare:** require each Worker's runtime secrets in wrangler.jsonc ([#278](https://github.com/plvo/create-faster/issues/278)) ([f33d800](https://github.com/plvo/create-faster/commit/f33d800f2502a0e94dbcbd9eac6f9283cd535beb))
* **evlog:** wire tanstack start on cloudflare workers ([#200](https://github.com/plvo/create-faster/issues/200)) ([2b61bdc](https://github.com/plvo/create-faster/commit/2b61bdc0be2865693802c0d5a6cff9f39d82c74d))
* **library:** extract posthog from the showcase blueprint ([#163](https://github.com/plvo/create-faster/issues/163)) ([e758793](https://github.com/plvo/create-faster/commit/e758793d72a4fd3d17603253a0442bb50fd952ef)), closes [#116](https://github.com/plvo/create-faster/issues/116)
* **linter:** add oxc option with oxlint, oxfmt and @shadcn/lint ([#167](https://github.com/plvo/create-faster/issues/167)) ([0286651](https://github.com/plvo/create-faster/commit/02866510cac4466c47fe14e16bcbf1d6dac7ec88))
* **post-generate:** format generated files after install ([#288](https://github.com/plvo/create-faster/issues/288)) ([30ccd79](https://github.com/plvo/create-faster/commit/30ccd79af8c4afd0102a1d411590c967b5fee55a))
* **sst:** pass runtime secrets to deployed apps via sst.Secret ([#290](https://github.com/plvo/create-faster/issues/290)) ([0b16ca9](https://github.com/plvo/create-faster/commit/0b16ca9e80b375041c5018b13453a73d5fcce8bc))
* **tanstack-start:** deploy to cloudflare workers with the vite plugin ([#195](https://github.com/plvo/create-faster/issues/195)) ([c3e0cb6](https://github.com/plvo/create-faster/commit/c3e0cb6273be39dc0465904f88e4c8739dc50616))
* **tanstack-start:** support better-auth ([#201](https://github.com/plvo/create-faster/issues/201)) ([c817206](https://github.com/plvo/create-faster/commit/c8172065877435bd84ecd2bfdcdbaeebed149ecf))
* **tanstack-start:** support cloudflare-static ([#199](https://github.com/plvo/create-faster/issues/199)) ([02375ce](https://github.com/plvo/create-faster/commit/02375ce1da501ddabfd5250d2a3ac2c49867670e))
* **tanstack-start:** support mdx ([#194](https://github.com/plvo/create-faster/issues/194)) ([cd3d238](https://github.com/plvo/create-faster/commit/cd3d2387f25b5c060d195929ace1bf8b61274a6c))
* **tanstack-start:** support next-themes ([#193](https://github.com/plvo/create-faster/issues/193)) ([39b57ce](https://github.com/plvo/create-faster/commit/39b57ce33c20130bfc8245724fb67b5f5c04e1e7))
* **tanstack-start:** support posthog ([#198](https://github.com/plvo/create-faster/issues/198)) ([cd5ad4c](https://github.com/plvo/create-faster/commit/cd5ad4c881fb7afc88d90774d740ca9d2f4d436c))
* **tanstack-start:** support trpc ([#213](https://github.com/plvo/create-faster/issues/213)) ([559075b](https://github.com/plvo/create-faster/commit/559075b74ad82788f7f00bab4f5f9bac73df13d7))
* **templates:** add handlebars partials for shared template blocks ([#209](https://github.com/plvo/create-faster/issues/209)) ([5cd8907](https://github.com/plvo/create-faster/commit/5cd890722d8d846c31d8d6f78f1a82992cb63a8f))


### Bug Fixes

* **better-auth:** allow users to share a display name ([#234](https://github.com/plvo/create-faster/issues/234)) ([73feff0](https://github.com/plvo/create-faster/commit/73feff0c31ec8475e7007390ca71bc49cedb7de7))
* **better-auth:** rate limit per client on Start apps on Nitro ([#286](https://github.com/plvo/create-faster/issues/286)) ([870c747](https://github.com/plvo/create-faster/commit/870c7476c7054f8da8e34fae8e87805aefba0489))
* **better-auth:** sign up on postgres projects ([#202](https://github.com/plvo/create-faster/issues/202)) ([151fc36](https://github.com/plvo/create-faster/commit/151fc3673e3f82eb46a1b79599794b6e48af7b76))
* **better-auth:** trust the platform client ip header for rate limiting ([#223](https://github.com/plvo/create-faster/issues/223)) ([0fe5c29](https://github.com/plvo/create-faster/commit/0fe5c292b57ad9c49421c0a4b6f81d94d7cd61c0))
* **blueprints:** accessible fullstack admin pages on phones ([#327](https://github.com/plvo/create-faster/issues/327)) ([45ff971](https://github.com/plvo/create-faster/commit/45ff971d27cdca299fa3b5e24b5a9e9dacd628de))
* **blueprints:** accessible names and phone layout on org dashboards ([#323](https://github.com/plvo/create-faster/issues/323)) ([90647d3](https://github.com/plvo/create-faster/commit/90647d30cda2c798c64b09f375df757d1bfe3dc7))
* **blueprints:** add the better-auth admin session column to the schemas ([#232](https://github.com/plvo/create-faster/issues/232)) ([4485755](https://github.com/plvo/create-faster/commit/4485755b21c5873d6c35dcd500af63d83459f77e))
* **blueprints:** answer 404 for an unknown id on detail pages ([#333](https://github.com/plvo/create-faster/issues/333)) ([a314fcd](https://github.com/plvo/create-faster/commit/a314fcdb7dbf69a1cd392186450d717056fb998a))
* **blueprints:** close org-dashboard sign-up and fix auth redirects ([#246](https://github.com/plvo/create-faster/issues/246)) ([44c73d6](https://github.com/plvo/create-faster/commit/44c73d6bb14ed7058f68afe23478a3a2056fb2fb))
* **blueprints:** complete og and twitter metadata on every page ([#261](https://github.com/plvo/create-faster/issues/261)) ([710c6a3](https://github.com/plvo/create-faster/commit/710c6a31848b254c7844c03f1ab5121c78205cd1))
* **blueprints:** guard signup and admin pages for signed-in users ([#254](https://github.com/plvo/create-faster/issues/254)) ([a172d54](https://github.com/plvo/create-faster/commit/a172d54ef5e0156872f4220562c9fb5c7ef56503))
* **blueprints:** keep the NODE_ENV define quoted under npm and pnpm ([#346](https://github.com/plvo/create-faster/issues/346)) ([db74d6d](https://github.com/plvo/create-faster/commit/db74d6dae64745fdbafa3f63a7f77965f9f7d9e5))
* **blueprints:** link the og image in showcase and static site ([#256](https://github.com/plvo/create-faster/issues/256)) ([c241614](https://github.com/plvo/create-faster/commit/c2416148c770d6ed95ec637483d425a228bbebe8))
* **blueprints:** load the environment in every Node seed ([#347](https://github.com/plvo/create-faster/issues/347)) ([57a6435](https://github.com/plvo/create-faster/commit/57a6435ca8ff6b34b1e0510f457f3da6ca1be980))
* **blueprints:** name records in dashboard breadcrumbs ([#329](https://github.com/plvo/create-faster/issues/329)) ([c86f48f](https://github.com/plvo/create-faster/commit/c86f48f671d728097d8df24abb136accc22039d6))
* **blueprints:** one app url variable and canonical urls in SEO blueprints ([#270](https://github.com/plvo/create-faster/issues/270)) ([2fdec6f](https://github.com/plvo/create-faster/commit/2fdec6f6da0286562932423b83d4c81bd6f6c843))
* **blueprints:** pin the Privy packages and viem to one set ([#312](https://github.com/plvo/create-faster/issues/312)) ([820f9bd](https://github.com/plvo/create-faster/commit/820f9bdc886bf6a91eb191b0ecd10b052270af73))
* **blueprints:** prefetch fullstack admin queries on the server ([#331](https://github.com/plvo/create-faster/issues/331)) ([47a9da0](https://github.com/plvo/create-faster/commit/47a9da0643cfdd1b3e84366695e474c795cdb1d6))
* **blueprints:** run only the scripts a project defines in its deploy workflow ([#210](https://github.com/plvo/create-faster/issues/210)) ([fdb3148](https://github.com/plvo/create-faster/commit/fdb3148494796cbcaf3f28cc1d221f587298a422))
* **blueprints:** warn in production when links are only logged ([#284](https://github.com/plvo/create-faster/issues/284)) ([dd925f3](https://github.com/plvo/create-faster/commit/dd925f3523d5c9aabac9ed53bb5d50e82a625e7d))
* **cli:** exit 1 without a terminal when answers are missing ([#345](https://github.com/plvo/create-faster/issues/345)) ([1df54ce](https://github.com/plvo/create-faster/commit/1df54ce8c7702234872e99d208554b758e996392))
* **cli:** explain a missing package manager before generating ([#222](https://github.com/plvo/create-faster/issues/222)) ([7573c9c](https://github.com/plvo/create-faster/commit/7573c9cce240acf3916a579b791e52fdaac56ad1))
* **cli:** initialize git before installing dependencies ([#351](https://github.com/plvo/create-faster/issues/351)) ([a1964e0](https://github.com/plvo/create-faster/commit/a1964e0ae024303d25e9f4a8c40502c022c196da))
* **cli:** prompt each project category no flag answered ([#289](https://github.com/plvo/create-faster/issues/289)) ([c83bfa7](https://github.com/plvo/create-faster/commit/c83bfa7073989b6d628eb21c3c074818c273537b))
* **cli:** reflect a failed git init and make knip pass in CI ([#260](https://github.com/plvo/create-faster/issues/260)) ([1375c5f](https://github.com/plvo/create-faster/commit/1375c5f3c86000298f1c165af21a090ddc595a1e))
* **cli:** report a failed git init unambiguously ([#262](https://github.com/plvo/create-faster/issues/262)) ([62d7c1c](https://github.com/plvo/create-faster/commit/62d7c1c7f112ea5628bf1ed00492a785bc389f0e))
* **cli:** tell the user to generate BETTER_AUTH_SECRET ([#356](https://github.com/plvo/create-faster/issues/356)) ([b3d8c1b](https://github.com/plvo/create-faster/commit/b3d8c1b1c7d3932554d6a5b38f90643064a45dd3))
* **cli:** use the last path segment as the project name ([#321](https://github.com/plvo/create-faster/issues/321)) ([df68eb4](https://github.com/plvo/create-faster/commit/df68eb4dc1d2eeebba36247d046e816f4f96fe63))
* **cli:** validate app names like the project name ([#326](https://github.com/plvo/create-faster/issues/326)) ([3df6ead](https://github.com/plvo/create-faster/commit/3df6ead1c631097c68fbb6e50eb76e90a49b12bc))
* **cloudflare-fullstack:** print per-app scripts from their directory ([#266](https://github.com/plvo/create-faster/issues/266)) ([e9a243d](https://github.com/plvo/create-faster/commit/e9a243d8436238ceb79d4bcf69fffe6df87072e2))
* **cloudflare:** generate binding types on install, one script name ([#264](https://github.com/plvo/create-faster/issues/264)) ([5cb14c4](https://github.com/plvo/create-faster/commit/5cb14c40fdbe9d8b9310bbd4485984db8380118a))
* **cloudflare:** pair next and OpenNext inside the peer range ([#295](https://github.com/plvo/create-faster/issues/295)) ([bc1e1b8](https://github.com/plvo/create-faster/commit/bc1e1b828db1780bd56dd202e27df721673f4dad))
* **cloudflare:** pin Next.js to 16.3 for OpenNext Workers ([#281](https://github.com/plvo/create-faster/issues/281)) ([8227e40](https://github.com/plvo/create-faster/commit/8227e40a88cdfd8b4aef95c066eb6192244e7be6))
* **cloudflare:** run next build once, declare wrangler in db ([#259](https://github.com/plvo/create-faster/issues/259)) ([4862a74](https://github.com/plvo/create-faster/commit/4862a745fc569ad9797c5819451d71c34a1dfd5a))
* **d1:** read the local database where migrations write it ([#196](https://github.com/plvo/create-faster/issues/196)) ([2471491](https://github.com/plvo/create-faster/commit/2471491ef1a0d49107809b2b7adaeab37961f91a))
* **d1:** share one database and local state across Workers ([#235](https://github.com/plvo/create-faster/issues/235)) ([1a2ce49](https://github.com/plvo/create-faster/commit/1a2ce499074d0ceacbf5641e5c789c283556047f))
* **dapp-privy:** use a placeholder app ID the Privy SDK accepts ([#275](https://github.com/plvo/create-faster/issues/275)) ([c7ae4b6](https://github.com/plvo/create-faster/commit/c7ae4b6f150d5a57453e89c533fabf07b96eff2c))
* **dapp-rainbowkit:** build and verify SIWE on any host ([#241](https://github.com/plvo/create-faster/issues/241)) ([d1da9aa](https://github.com/plvo/create-faster/commit/d1da9aa9d605aa5044c1b164298fe02ef48b07c6))
* **db:** generate the db package env only when an orm creates the package ([#221](https://github.com/plvo/create-faster/issues/221)) ([3207a78](https://github.com/plvo/create-faster/commit/3207a78022bac71f4ef1ab0fcd2ad352dc7fae86))
* **db:** keep mysql tls in production and let the local url disable it ([#285](https://github.com/plvo/create-faster/issues/285)) ([728a4c2](https://github.com/plvo/create-faster/commit/728a4c2f5d1a0d853ee1e9208be3d6814368d4ad))
* **db:** keep postgres tls in production and let the local url disable it ([#207](https://github.com/plvo/create-faster/issues/207)) ([a675ef1](https://github.com/plvo/create-faster/commit/a675ef1945def02a857363047448090c66befd97))
* **db:** make the database first run work from a fresh clone ([#243](https://github.com/plvo/create-faster/issues/243)) ([148953c](https://github.com/plvo/create-faster/commit/148953c5af73cc5a22048936a916c79a7e12aaee))
* **db:** probe the compose database over tcp before --wait returns ([#287](https://github.com/plvo/create-faster/issues/287)) ([fa17f80](https://github.com/plvo/create-faster/commit/fa17f80efd12b7c6a9bf5feb0fca249779f9a440))
* **deployment:** reject sqlite under sst and terraform-aws ([#283](https://github.com/plvo/create-faster/issues/283)) ([f72b3c4](https://github.com/plvo/create-faster/commit/f72b3c4d40106d64a011148c2f18e4f7ea21fe3a))
* **deps:** declare which dependency install scripts may run ([#309](https://github.com/plvo/create-faster/issues/309)) ([b96e267](https://github.com/plvo/create-faster/commit/b96e267479c080e2f7d7aa9284537418895129de))
* **docs:** correct generated commands, apps and packages ([#247](https://github.com/plvo/create-faster/issues/247)) ([9ae2c2a](https://github.com/plvo/create-faster/commit/9ae2c2a6f1d85eb0ea81c88d30bc24a03c525b3d))
* **drizzle:** use a per-request pg Client over Hyperdrive ([#191](https://github.com/plvo/create-faster/issues/191)) ([d813169](https://github.com/plvo/create-faster/commit/d8131692d69d64b05785f1023ae22a8270af7bd5))
* **evlog:** import createInstrumentation from its create subpath ([#165](https://github.com/plvo/create-faster/issues/165)) ([efbeaa1](https://github.com/plvo/create-faster/commit/efbeaa1660e270e39f6a5aae9b968f2a253246e2))
* **evlog:** install Start apps under npm within the nitro peer ([#313](https://github.com/plvo/create-faster/issues/313)) ([1aa8526](https://github.com/plvo/create-faster/commit/1aa8526019c04b16095aa41cb9820029f2ebd09b))
* **expo:** upgrade to Expo SDK 57 and fix the app setup ([#249](https://github.com/plvo/create-faster/issues/249)) ([19f3a4d](https://github.com/plvo/create-faster/commit/19f3a4dd61a8c91114a1fd79ce90538d8e357a9d))
* **flags:** check requirements when no project flag is given ([#227](https://github.com/plvo/create-faster/issues/227)) ([9716806](https://github.com/plvo/create-faster/commit/97168065d7922e4e7640dee3238a769e38518662))
* **generated:** scope worker names, mdx content, app url and test scripts ([#251](https://github.com/plvo/create-faster/issues/251)) ([0f533fb](https://github.com/plvo/create-faster/commit/0f533fba9a8645fcb9b2d9fad236378afc055c79))
* **generated:** ship favicons and seo images, title the 404 page ([#252](https://github.com/plvo/create-faster/issues/252)) ([c15b56c](https://github.com/plvo/create-faster/commit/c15b56cc571071e5634d04ce765b39891b8cc92d))
* **generated:** silence vitest warnings and ignore tool output ([#245](https://github.com/plvo/create-faster/issues/245)) ([20a8279](https://github.com/plvo/create-faster/commit/20a827904e00147cc3177442e4fa70803a55e64a))
* **hono:** allow put, patch and delete in the cors preflight ([#255](https://github.com/plvo/create-faster/issues/255)) ([f27ef38](https://github.com/plvo/create-faster/commit/f27ef385cd2542964f1ca23aec1d3b8b0786cf19))
* **hono:** declare the hyperdrive binding on cloudflare ([#212](https://github.com/plvo/create-faster/issues/212)) ([26de90b](https://github.com/plvo/create-faster/commit/26de90b352a770692b47757e9e39a571358c469e))
* **hono:** listen on the app port in dev and start ([#238](https://github.com/plvo/create-faster/issues/238)) ([44df545](https://github.com/plvo/create-faster/commit/44df5451e06ac69fbb68a77765e870786b21053b))
* **lambda-terraform-aws:** build lambdas in production mode ([#224](https://github.com/plvo/create-faster/issues/224)) ([3078972](https://github.com/plvo/create-faster/commit/30789728354de1b370bd3d5d40646fa11e70356b))
* **lambda-terraform-aws:** ship handlers lambda can load ([#208](https://github.com/plvo/create-faster/issues/208)) ([158e733](https://github.com/plvo/create-faster/commit/158e733b16cdf60a92074a9dbdcc76cc96ee5170))
* **linter:** leave the Drizzle migrations to drizzle-kit ([#354](https://github.com/plvo/create-faster/issues/354)) ([f6e11e2](https://github.com/plvo/create-faster/commit/f6e11e2a39c96595f0cf6ee6c10cf20235bb7f6c))
* **linters:** make generated projects pass their own lint script ([#267](https://github.com/plvo/create-faster/issues/267)) ([bbcdafc](https://github.com/plvo/create-faster/commit/bbcdafc32bb50c7ba3ad0fdbff4cf8cef40ae3cc))
* **multitenant-saas:** guard prefetching pages with a server session check ([#257](https://github.com/plvo/create-faster/issues/257)) ([9f71294](https://github.com/plvo/create-faster/commit/9f71294f979a35cb74ea12adbdfc1146f73d417e))
* **nextjs:** align @next/bundle-analyzer with the next range ([#269](https://github.com/plvo/create-faster/issues/269)) ([6fc4dec](https://github.com/plvo/create-faster/commit/6fc4deca1a63d5aeb4802658e5934477e396ac87))
* **nextjs:** drop the webpack-only bundle analyzer wrapper ([#271](https://github.com/plvo/create-faster/issues/271)) ([ef4a101](https://github.com/plvo/create-faster/commit/ef4a10136252a5cf3b769a131d47dc501a165784))
* **nextjs:** drop trailing slashes from the app url ([#276](https://github.com/plvo/create-faster/issues/276)) ([8f8affe](https://github.com/plvo/create-faster/commit/8f8affe655f9b9cc92de8f1a90980d4ce2190751))
* **nextjs:** mount AppProviders in the stack root layout ([#189](https://github.com/plvo/create-faster/issues/189)) ([cea1912](https://github.com/plvo/create-faster/commit/cea19123512b5d51464ff8b8f44ce1dc9e454e74))
* **nextjs:** run cloudflare deployments with NODE_ENV=production ([#217](https://github.com/plvo/create-faster/issues/217)) ([1dc8a82](https://github.com/plvo/create-faster/commit/1dc8a826bad1efd7a6509cb5a48a919e349e77c0))
* **nextjs:** serve the mdx example under /mdx ([#204](https://github.com/plvo/create-faster/issues/204)) ([a3607bb](https://github.com/plvo/create-faster/commit/a3607bbd9ff501fcdd62b2af2bdbb083ee242a30))
* **nextjs:** stop next dev from writing into AGENTS.md ([#258](https://github.com/plvo/create-faster/issues/258)) ([875c11a](https://github.com/plvo/create-faster/commit/875c11a6e8281d6e2e704f95a6775bc5274e6349))
* **nextjs:** stop querying the session in the generated proxy ([#242](https://github.com/plvo/create-faster/issues/242)) ([867667c](https://github.com/plvo/create-faster/commit/867667c40b1fa83c998b7370f7a51203a3c61c73))
* **orm:** generate the Prisma client in the first-run steps ([#348](https://github.com/plvo/create-faster/issues/348)) ([ea2b3bd](https://github.com/plvo/create-faster/commit/ea2b3bd0cc6b73ebcc7042d4200dce0d0cfe60b2))
* **playwright:** run the dev server with the selected package manager ([#273](https://github.com/plvo/create-faster/issues/273)) ([f25f9bc](https://github.com/plvo/create-faster/commit/f25f9bca50d6c94714bcc51f3feec196010cf425))
* **portless:** keep env assignments in front of portless run ([#239](https://github.com/plvo/create-faster/issues/239)) ([4ce167b](https://github.com/plvo/create-faster/commit/4ce167b3dd5cebcb51d7bd7f310ef2d29c872607))
* **post-generation:** exit non-zero when the dependency install fails ([#237](https://github.com/plvo/create-faster/issues/237)) ([e12e83f](https://github.com/plvo/create-faster/commit/e12e83f4b98014195f82bc354d17abbf3dd09b6e))
* **prisma:** use hyperdrive on cloudflare and keep mysql tls settings ([#225](https://github.com/plvo/create-faster/issues/225)) ([179b061](https://github.com/plvo/create-faster/commit/179b061e9fd8b6981eea29d554d1f3d385b91956))
* render generated readme sections and fix stale help and docs paths ([#219](https://github.com/plvo/create-faster/issues/219)) ([8563a38](https://github.com/plvo/create-faster/commit/8563a3886c79dc002aaaefca336579887b1e63a2))
* **scripts:** run blueprint and seed scripts without Bun ([#294](https://github.com/plvo/create-faster/issues/294)) ([23a60e5](https://github.com/plvo/create-faster/commit/23a60e549727f4adb78473fe8b042a1ab30e5a02))
* **sqlite:** reject sqlite on the cloudflare deployment ([#229](https://github.com/plvo/create-faster/issues/229)) ([380e47c](https://github.com/plvo/create-faster/commit/380e47c5743c0489636f97764e782471a8ffaea3))
* **sst:** deploy hono apps with a lambda handler ([#206](https://github.com/plvo/create-faster/issues/206)) ([b04b856](https://github.com/plvo/create-faster/commit/b04b856ac614717327b285767d8566e6ca14389f))
* **sst:** deploy tanstack start with sst.aws.TanStackStart ([#197](https://github.com/plvo/create-faster/issues/197)) ([8f29a7d](https://github.com/plvo/create-faster/commit/8f29a7de5f97a2f7fb9ddd37f09db710bdff8e3c))
* **sst:** keep sst.config.ts out of the app tsconfig ([#291](https://github.com/plvo/create-faster/issues/291)) ([92d836f](https://github.com/plvo/create-faster/commit/92d836f76e051df45402deca04e6009fc1310b26))
* **stacks:** run Hono, Node and Lambda builds without Bun ([#296](https://github.com/plvo/create-faster/issues/296)) ([6e00749](https://github.com/plvo/create-faster/commit/6e0074968ee31cfccc72f93f892f59210d24c008))
* **summary:** print the install step when install is skipped ([#277](https://github.com/plvo/create-faster/issues/277)) ([a3c18d7](https://github.com/plvo/create-faster/commit/a3c18d7a4982df3f7aaa31e0c5c63a33306981d5))
* **tanstack-devtools:** mount only the selected panels on Next.js ([#240](https://github.com/plvo/create-faster/issues/240)) ([ed0c7c4](https://github.com/plvo/create-faster/commit/ed0c7c4b9c17e23eb991823d5d8fbc9e0dd8e872))
* **tanstack-devtools:** wire the devtools shell into TanStack Start ([#230](https://github.com/plvo/create-faster/issues/230)) ([85bde98](https://github.com/plvo/create-faster/commit/85bde987f34c38a0d33296607809cd731ead8468))
* **tanstack-start:** declare the Vite client types in vite-env.d.ts ([#350](https://github.com/plvo/create-faster/issues/350)) ([e247f47](https://github.com/plvo/create-faster/commit/e247f47397d7830835944dbe38a4b6ab68ae969e))
* **tanstack-start:** install the router CLI as a dependency ([#274](https://github.com/plvo/create-faster/issues/274)) ([6f8dbc9](https://github.com/plvo/create-faster/commit/6f8dbc90329d93ebd700781b3adb5d302e990c10))
* **tanstack-start:** keep csrf protection when start.ts is generated ([#215](https://github.com/plvo/create-faster/issues/215)) ([5533282](https://github.com/plvo/create-faster/commit/5533282e298b41fc27205257fcd55d63f8582cc3))
* **tanstack-start:** load native sqlite bindings under nitro ([#203](https://github.com/plvo/create-faster/issues/203)) ([9f800f9](https://github.com/plvo/create-faster/commit/9f800f9236834f83bd2b2e5f3155651a846e055d))
* **tanstack-start:** load the app env file in the start script ([#205](https://github.com/plvo/create-faster/issues/205)) ([8f1bc08](https://github.com/plvo/create-faster/commit/8f1bc08705e878984373d33f396ba68aea47e111))
* **tanstack-start:** remove hydration error on static 404 page ([#244](https://github.com/plvo/create-faster/issues/244)) ([ccfbefe](https://github.com/plvo/create-faster/commit/ccfbefed1237cd4fa7fa3b71252bd02be2ab8c16))
* **tanstack-start:** route tree on install, per-app deploy notes ([#265](https://github.com/plvo/create-faster/issues/265)) ([47982b1](https://github.com/plvo/create-faster/commit/47982b12c9e5b924838ae2c9ea5bfd8a078ad4f2))
* **tanstack-start:** run production servers with NODE_ENV=production ([#214](https://github.com/plvo/create-faster/issues/214)) ([267b55a](https://github.com/plvo/create-faster/commit/267b55a5dd1f18a8291be8ab4c2d0dbf6e76b813))
* **tanstack-start:** serve production builds through nitro ([#168](https://github.com/plvo/create-faster/issues/168)) ([f7d2b0b](https://github.com/plvo/create-faster/commit/f7d2b0b25e7b3225a757ce28920e4e78bd1b1084))
* **templates:** generate projects that lint without biome warnings ([#307](https://github.com/plvo/create-faster/issues/307)) ([a9c9f9a](https://github.com/plvo/create-faster/commit/a9c9f9a11d73a767519bdb14a8a14b5fabb8cee4))
* **templates:** pass eslint on Start MDX and trpc apps ([#353](https://github.com/plvo/create-faster/issues/353)) ([8a6d59b](https://github.com/plvo/create-faster/commit/8a6d59b90a80def4e3c070301e39e580e8d888ab))
* **trpc:** keep Next.js control-flow errors out of the server log ([#280](https://github.com/plvo/create-faster/issues/280)) ([3e7c3fc](https://github.com/plvo/create-faster/commit/3e7c3fc9d0d1a07c38cdd3594abf57ef4ba6ec7b))
* **trpc:** log unexpected errors in every environment ([#231](https://github.com/plvo/create-faster/issues/231)) ([8a03444](https://github.com/plvo/create-faster/commit/8a03444a294906eab4fe02de3bef302bb09924fc))
* **trpc:** log unexpected errors of server-side tRPC calls ([#253](https://github.com/plvo/create-faster/issues/253)) ([e325f71](https://github.com/plvo/create-faster/commit/e325f719053cc944217c68f7aac643854b6f2ca5))
* **trpc:** use the prisma client export with prisma projects ([#218](https://github.com/plvo/create-faster/issues/218)) ([d17d7be](https://github.com/plvo/create-faster/commit/d17d7bee497cf21f9a605a80127a5808c1f8eacd))
* **turborepo:** declare the pnpm workspace ([#211](https://github.com/plvo/create-faster/issues/211)) ([ed1485d](https://github.com/plvo/create-faster/commit/ed1485d22c97432de4b0733cba4006b199e0def0))
* **turborepo:** list every root script in the README ([#268](https://github.com/plvo/create-faster/issues/268)) ([2e0dd2c](https://github.com/plvo/create-faster/commit/2e0dd2cee5af8e4254661532b61d8a8aa2fe02d8))
* **turborepo:** resolve package exports and type-check packages ([#250](https://github.com/plvo/create-faster/issues/250)) ([8e64475](https://github.com/plvo/create-faster/commit/8e64475d0823ca9dc2b3924915a1477b3080a623))


### Performance

* **trpc:** build the server context once per request ([#190](https://github.com/plvo/create-faster/issues/190)) ([e8c6d0a](https://github.com/plvo/create-faster/commit/e8c6d0aa8003480411da78363588b72bcef2a5cc))


### Refactor

* **blueprints:** suffix org-dashboard-nextjs framework files ([#308](https://github.com/plvo/create-faster/issues/308)) ([98041ca](https://github.com/plvo/create-faster/commit/98041ca5734d8a63a7669cb063401b9fa13ee8d3))


### Documentation

* **cloudflare:** pass --ignore-scripts on a production install ([#279](https://github.com/plvo/create-faster/issues/279)) ([944c906](https://github.com/plvo/create-faster/commit/944c906df8b27ae4937af44d42eb2177d27e2201))
* make AGENTS.md the root agent guide and gitignore .tanstack ([#216](https://github.com/plvo/create-faster/issues/216)) ([2595d9b](https://github.com/plvo/create-faster/commit/2595d9bf4b1fc0b4fb7046042246b08860576a41))
* **trpc:** say a Next.js page that prefetches must be dynamic ([#282](https://github.com/plvo/create-faster/issues/282)) ([75a6169](https://github.com/plvo/create-faster/commit/75a61695c8026b2eed590cfa83f9855f7ad39d08))


### Tests

* **cli:** read plain CLI output in every environment ([#263](https://github.com/plvo/create-faster/issues/263)) ([7c817d7](https://github.com/plvo/create-faster/commit/7c817d7d6a8e606da1e29a48d7c3e434b155d659))
* **cli:** set the integration timeout in every test file ([#357](https://github.com/plvo/create-faster/issues/357)) ([81778d8](https://github.com/plvo/create-faster/commit/81778d85994be44ecfb799bd47b5783795d34af6))
* **integration:** raise the per-test timeout to 120 s ([#305](https://github.com/plvo/create-faster/issues/305)) ([459e634](https://github.com/plvo/create-faster/commit/459e6341e67efd00ff0d667c646e6342f5e25ec8))
* **resolver:** remove the temp directory the scan test creates ([#316](https://github.com/plvo/create-faster/issues/316)) ([12c957e](https://github.com/plvo/create-faster/commit/12c957e87dcec28cfc90491c278f973d099410e1))


### Build

* **cli:** typecheck in ci and fix existing type errors ([#220](https://github.com/plvo/create-faster/issues/220)) ([7ec3aa1](https://github.com/plvo/create-faster/commit/7ec3aa1f09e9cc6fc980b8a30c268d3a9db00f75))

## [1.6.7](https://github.com/plvo/create-faster/compare/create-faster-v1.6.6...create-faster-v1.6.7) (2026-10-01)


### Build

* **deps:** bump all dependencies to latest, fix breaking changes ([#159](https://github.com/plvo/create-faster/issues/159)) ([68d10c6](https://github.com/plvo/create-faster/commit/68d10c613a9a6d1b0f8129f4d009bd4018645b25))

## [1.6.6](https://github.com/plvo/create-faster/compare/create-faster-v1.6.5...create-faster-v1.6.6) (2026-06-23)


### Features

* **auth:** better-auth sqlite support via drizzle adapter ([#144](https://github.com/plvo/create-faster/issues/144)) ([e0dbb2a](https://github.com/plvo/create-faster/commit/e0dbb2a7e2151b8516fca899e714ff89a00a3b78))
* **blueprint:** add cloudflare-fullstack dashboard blueprint ([#158](https://github.com/plvo/create-faster/issues/158)) ([8a36034](https://github.com/plvo/create-faster/commit/8a360341eca090c7da654c27515e8357c1cb8ef8))
* **blueprint:** cloudflare-static-site ([#157](https://github.com/plvo/create-faster/issues/157)) ([99ce8fa](https://github.com/plvo/create-faster/commit/99ce8fab5d232d0a9e27409ce54502aafbb60ba9))
* **blueprint:** org-dashboard RBAC, auto-password, responsive dialogs, login card ([#136](https://github.com/plvo/create-faster/issues/136)) ([5002e34](https://github.com/plvo/create-faster/commit/5002e34abd2fbea848c3011fc39cd7030fc13aaf))
* **cloudflare-static:** Next.js static export deployment to Cloudflare Workers assets ([#149](https://github.com/plvo/create-faster/issues/149)) ([513e517](https://github.com/plvo/create-faster/commit/513e51749c8894ef6f14ff565040bfaa3e6798dd))
* **d1:** wire better-auth + tRPC per-request consumers ([#153](https://github.com/plvo/create-faster/issues/153)) ([#155](https://github.com/plvo/create-faster/issues/155)) ([8914fe3](https://github.com/plvo/create-faster/commit/8914fe3e2e1bbff8c3a6bf6387b0a83e86f3deee))
* **database:** Cloudflare D1 option (d1) with declarative cloudflare constraint ([#150](https://github.com/plvo/create-faster/issues/150)) ([a0e96e0](https://github.com/plvo/create-faster/commit/a0e96e0c41e11dfa37648bf0405daef870edf052))
* **database:** Postgres/MySQL on Cloudflare via Hyperdrive ([#148](https://github.com/plvo/create-faster/issues/148)) ([#154](https://github.com/plvo/create-faster/issues/154)) ([79143e3](https://github.com/plvo/create-faster/commit/79143e308cf5e0115c8e5ce571d98191e2a1a1b7))
* **database:** sqlite option with Drizzle integration ([#139](https://github.com/plvo/create-faster/issues/139)) ([56648fb](https://github.com/plvo/create-faster/commit/56648fb3cb13b4f163a74df0295a68849ca066a9))
* **deployment:** Cloudflare as a deployment platform ([#147](https://github.com/plvo/create-faster/issues/147)) ([09db427](https://github.com/plvo/create-faster/commit/09db42772a5d3eae1be6286eb2ae131fe053141a))
* **libraries:** cloudflare deploy library for Hono (Workers) ([#137](https://github.com/plvo/create-faster/issues/137)) ([2d84e49](https://github.com/plvo/create-faster/commit/2d84e495b4c4b41430d8997a6202e12efe4ad5fc))
* **prompts:** show incompatible options disabled with reason (not hidden) ([#152](https://github.com/plvo/create-faster/issues/152)) ([5aaf3be](https://github.com/plvo/create-faster/commit/5aaf3be705775dac8b5a65bf436045caa1a8902c))


### Bug Fixes

* **d1:** make the turbo db:migrate workflow target the deploy app config ([#156](https://github.com/plvo/create-faster/issues/156)) ([8a61506](https://github.com/plvo/create-faster/commit/8a61506db9d794e987afd15ef5c0a5161c615168))
* **drizzle:** replace bundler-hostile import.meta.url with cwd-based sqlite path resolution ([#146](https://github.com/plvo/create-faster/issues/146)) ([e4a000f](https://github.com/plvo/create-faster/commit/e4a000fba959ca2686f03d1ad873c82bc967e9dd))

## [1.6.5](https://github.com/plvo/create-faster/compare/create-faster-v1.6.4...create-faster-v1.6.5) (2026-05-29)


### Features

* AI-agent context generation (AGENTS.md + CLAUDE.md) ([417fffa](https://github.com/plvo/create-faster/commit/417fffafa48960ffde11ded5f8d5088dfd821f18))
* **blueprint/org-dashboard:** packages/ui + shuip forms migration (PR1) ([#120](https://github.com/plvo/create-faster/issues/120)) ([35e5d59](https://github.com/plvo/create-faster/commit/35e5d5908c80ab88440be32c1d06f8825b50b542))
* **blueprint:** add multitenant-saas ([#114](https://github.com/plvo/create-faster/issues/114)) ([5a53929](https://github.com/plvo/create-faster/commit/5a5392908f14ecfe91b4cdd6a8837c0a11ab081d))
* **blueprints:** local-setup orchestrator + idempotent seed tooling ([#124](https://github.com/plvo/create-faster/issues/124)) ([614c1dc](https://github.com/plvo/create-faster/commit/614c1dc6aabb63fdf0be79cb6a8c39fb3021c626))
* **docker/db:** randomize host port for containers ([#118](https://github.com/plvo/create-faster/issues/118)) ([5ac48ff](https://github.com/plvo/create-faster/commit/5ac48ff6b28d469618ce46e0ccc1361fa2308e9f))
* **testing:** add Vitest, Playwright & jest-expo testing libraries ([#123](https://github.com/plvo/create-faster/issues/123)) ([4b7f510](https://github.com/plvo/create-faster/commit/4b7f510fbb03fcb47963abc184567526266ec474))
* **tooling:** forward PORTLESS_URL in next.config.ts ([#115](https://github.com/plvo/create-faster/issues/115)) ([06089aa](https://github.com/plvo/create-faster/commit/06089aa119e04a5773beca52a50ff3b1495bf3e2))


### Bug Fixes

* **db/docker:** remove latest flag for img versions ([#117](https://github.com/plvo/create-faster/issues/117)) ([87e56e0](https://github.com/plvo/create-faster/commit/87e56e008161b230686ba7e685a854e2f13cc5e2))
* **meta/shadcn:** move tailwindcss to devDependencies ([#119](https://github.com/plvo/create-faster/issues/119)) ([510d5e3](https://github.com/plvo/create-faster/commit/510d5e335982b13ec245c7af07144ecdab04a15e))
* **templates:** unify base url handling across auth and trpc ([#121](https://github.com/plvo/create-faster/issues/121)) ([d9751a5](https://github.com/plvo/create-faster/commit/d9751a579ab9b6adfed4eb573d1d5e82053dd801))


### Refactor

* **cli:** codebase quality pass (type consolidation, DRY) ([#112](https://github.com/plvo/create-faster/issues/112)) ([a3fd238](https://github.com/plvo/create-faster/commit/a3fd238d39c4d808a89404c089297de7f2ac1568))

## [1.6.4](https://github.com/plvo/create-faster/compare/create-faster-v1.6.3...create-faster-v1.6.4) (2026-04-09)


### Features

* **library:** add evlog observability library ([#110](https://github.com/plvo/create-faster/issues/110)) ([5489c0d](https://github.com/plvo/create-faster/commit/5489c0deae9374bf26aafe077bfd3b15238a5c49))
* **tooling:** add portless as project-level option ([#109](https://github.com/plvo/create-faster/issues/109)) ([9fb0206](https://github.com/plvo/create-faster/commit/9fb0206585d96a5e2f1fb441abfa5b1428c5bdf0))

## [1.6.3](https://github.com/plvo/create-faster/compare/create-faster-v1.6.2...create-faster-v1.6.3) (2026-03-19)


### Features

* **blueprints:** add the org-dashboard blueprint ([#103](https://github.com/plvo/create-faster/issues/103)) ([2cc1a19](https://github.com/plvo/create-faster/commit/2cc1a193feb8e8c6e7c42ad3de9472a078bc7d01))
* **blueprint:** SEO/GEO-optimized SaaS landing page ([#104](https://github.com/plvo/create-faster/issues/104)) ([5989bc9](https://github.com/plvo/create-faster/commit/5989bc9b13230d88dc890ebf910c8d36d5d36cb6))


### Miscellaneous

* remove deprecated dashboard blueprint ([#108](https://github.com/plvo/create-faster/issues/108)) ([da83510](https://github.com/plvo/create-faster/commit/da83510d79ddd21691b5eb706bb826e57a171ff4))

## [1.6.2](https://github.com/plvo/create-faster/compare/create-faster-v1.6.1...create-faster-v1.6.2) (2026-03-16)


### Features

* **blueprints:** add dapp-rainbowkit blueprint with SIWE auth ([#92](https://github.com/plvo/create-faster/issues/92)) ([10498dd](https://github.com/plvo/create-faster/commit/10498dddc96b683fa059e51b4ec23bcc4163fb64))
* **blueprints:** add lambda-sst and lambda-terraform-aws blueprints ([#100](https://github.com/plvo/create-faster/issues/100)) ([469f17a](https://github.com/plvo/create-faster/commit/469f17a926e6f1e3fee8d010e9b057e3d9f3f5ee))
* **blueprints:** add Nextjs dApp Privy blueprint ([#89](https://github.com/plvo/create-faster/issues/89)) ([0e9140b](https://github.com/plvo/create-faster/commit/0e9140beb87be24af4a4dd7708beb1c5397478c5))
* **blueprints:** introduce blueprint system ([#85](https://github.com/plvo/create-faster/issues/85)) ([0b5e8f0](https://github.com/plvo/create-faster/commit/0b5e8f01a854a404f048dddcbd57514678982aab))
* **blueprints:** separate linter/tooling and group by category ([#90](https://github.com/plvo/create-faster/issues/90)) ([a189e69](https://github.com/plvo/create-faster/commit/a189e697face9781c9e9e18ee1a895c82f1c905b))
* **deployment:** add SST templates and project option ([#96](https://github.com/plvo/create-faster/issues/96)) ([ff6bf4e](https://github.com/plvo/create-faster/commit/ff6bf4e70e261d6f0702b154f1e91b9f155cb047))
* **deployment:** add Terraform AWS templates and project option ([#99](https://github.com/plvo/create-faster/issues/99)) ([fe6dc74](https://github.com/plvo/create-faster/commit/fe6dc74c2d4353f68c9559d93b9fa7bcd28bb647))
* **lib:** update better-auth v1.5.3 ([#87](https://github.com/plvo/create-faster/issues/87)) ([8caa845](https://github.com/plvo/create-faster/commit/8caa845aed86f943587d80f83060ecb664715a21))
* **lib:** update Prisma to v7 with driver adapters ([#88](https://github.com/plvo/create-faster/issues/88)) ([1973386](https://github.com/plvo/create-faster/commit/19733865ca56c445fc41d0ac0131a9542c70e7d7))
* **stacks:** add node stack for plain TypeScript projects ([#94](https://github.com/plvo/create-faster/issues/94)) ([1fd45f4](https://github.com/plvo/create-faster/commit/1fd45f49c60d7ca00e23f53b528800adb451d532))


### Bug Fixes

* **templates:** add shadcn CSS variables to globals.css ([#93](https://github.com/plvo/create-faster/issues/93)) ([1c608b8](https://github.com/plvo/create-faster/commit/1c608b8bb5a83c52005be6f272d5991d3b3da970))
* **templates:** fix better-auth schema FK type mismatch for uuid ([#91](https://github.com/plvo/create-faster/issues/91)) ([a858089](https://github.com/plvo/create-faster/commit/a8580896091a3764cd1e7f00197fa1760377803e))


### Refactor

* **cli:** improve code quality reduce duplication ([#101](https://github.com/plvo/create-faster/issues/101)) ([1581a78](https://github.com/plvo/create-faster/commit/1581a785ddd2b2f1e63155f9233ffe5b88332ad4))

## [1.6.1](https://github.com/plvo/create-faster/compare/create-faster-v1.6.0...create-faster-v1.6.1) (2026-03-02)


### Features

* **linter:** add Prettier and integration with ESLint ([#76](https://github.com/plvo/create-faster/issues/76)) ([e974132](https://github.com/plvo/create-faster/commit/e974132853f32d3f58283d7bb846b581482b4166))
* **meta:** extend $when with stack/library/repo/bool matchers ([#83](https://github.com/plvo/create-faster/issues/83)) ([4a1a188](https://github.com/plvo/create-faster/commit/4a1a18880ec1dfab7955de4dced9f50342e48ae8))
* separate linter category and add ESLint support ([#74](https://github.com/plvo/create-faster/issues/74)) ([e5b0236](https://github.com/plvo/create-faster/commit/e5b0236f9d7ebb02d61e5e6353b6d8758c6f0995))
* **tooling:** integrate lint-staged to husky ([#82](https://github.com/plvo/create-faster/issues/82)) ([f1b7fd7](https://github.com/plvo/create-faster/commit/f1b7fd719b59bd46363aa622bbc12119c979e1f6))
* **turborepo:** add syncpack for dependency version consistency ([#80](https://github.com/plvo/create-faster/issues/80)) ([49ead64](https://github.com/plvo/create-faster/commit/49ead64f55e601be1d8c88d7d10240d01cb4002d))


### Bug Fixes

* **meta:** package.json configs ([#84](https://github.com/plvo/create-faster/issues/84)) ([01f9a1e](https://github.com/plvo/create-faster/commit/01f9a1e8735bc6e3bdc2635b3f42f8b7f343ed2c))
* **templates/turborepo:** turbo task configuration for lint and clean ([#77](https://github.com/plvo/create-faster/issues/77)) ([1cfc2cb](https://github.com/plvo/create-faster/commit/1cfc2cb2dd2851bf7a55604aacd734812c07b28a))
* **templates:** add missing deps and static validation test ([#79](https://github.com/plvo/create-faster/issues/79)) ([97650a0](https://github.com/plvo/create-faster/commit/97650a02632e8f7256bdee280196a81df93f4790))


### Tests

* **e2e:** tests for generated projects, fix 19 template bugs ([#81](https://github.com/plvo/create-faster/issues/81)) ([c81d6fc](https://github.com/plvo/create-faster/commit/c81d6fcc908f96deb8af910c4a474a3d5309b225))

## [1.6.0](https://github.com/plvo/create-faster/compare/create-faster-v1.5.0...create-faster-v1.6.0) (2026-02-11)


### Features

* **prompts:** group library selection by category ([#72](https://github.com/plvo/create-faster/issues/72)) ([664fbc4](https://github.com/plvo/create-faster/commit/664fbc4dd8f99d55a814b74fea1ef1f45e2262d9))
* **templates:** add tRPC v11 library ([#69](https://github.com/plvo/create-faster/issues/69)) ([faae68e](https://github.com/plvo/create-faster/commit/faae68e8db12baff2b387da8d22952bf377825c2))


### Refactor

* **cli:** template system ([#63](https://github.com/plvo/create-faster/issues/63)) ([2c98fc0](https://github.com/plvo/create-faster/commit/2c98fc0dce660fb24c80e11286c11dba432ff12e))
* **tests:** organize test files into unit/ and integration/ ([#70](https://github.com/plvo/create-faster/issues/70)) ([e3761f2](https://github.com/plvo/create-faster/commit/e3761f2a23640d5d5064535ca71bbafcf346dc60))


### Documentation

* **www:** reorganize modules sidebar & enrich doc pages ([#73](https://github.com/plvo/create-faster/issues/73)) ([cb08b2b](https://github.com/plvo/create-faster/commit/cb08b2b7eeffe00090ca5c473af9e5b8585ce6db))


### Tests

* integration scripts for selective execution. ([e3761f2](https://github.com/plvo/create-faster/commit/e3761f2a23640d5d5064535ca71bbafcf346dc60))


### CI

* **tests:** add lint, unit and integration test steps to CI ([#71](https://github.com/plvo/create-faster/issues/71)) ([33c681d](https://github.com/plvo/create-faster/commit/33c681d863b2b2f87be6d8e884d1ba79c2c7c012))

## [1.5.0](https://github.com/plvo/create-faster/compare/create-faster-v1.4.1...create-faster-v1.5.0) (2026-02-02)


### Features

* **templates:** add nextjs proxy.ts file ([#59](https://github.com/plvo/create-faster/issues/59)) ([c1dcc4a](https://github.com/plvo/create-faster/commit/c1dcc4a3644392d8e57d6f55d839901f7a6ff0b4))
* **templates:** upgrade to Next.js 16 with React 19.2.3 ([#58](https://github.com/plvo/create-faster/issues/58)) ([1bedf3f](https://github.com/plvo/create-faster/commit/1bedf3fee5a93afe435a76104b45a9748ed2b9dd))


### Bug Fixes

* **handlebars:** use root context in helpers that access apps array ([#62](https://github.com/plvo/create-faster/issues/62)) ([1c9501f](https://github.com/plvo/create-faster/commit/1c9501f74eb31959a7672915489a13683b45b350))
* **templates:** add missing biome and husky deps in single-repo mode ([#56](https://github.com/plvo/create-faster/issues/56)) ([70f9bbd](https://github.com/plvo/create-faster/commit/70f9bbd386c424bef963f62fb5c05859c675da15))

## [1.4.1](https://github.com/plvo/create-faster/compare/create-faster-v1.3.1...create-faster-v1.4.0) (2026-01-02)


### Features

* add TanStack Start framework support ([#32](https://github.com/plvo/create-faster/issues/32)) ([1fb80e3](https://github.com/plvo/create-faster/commit/1fb80e3a9a7932fef50d02f209c70c3e2f2f635e))


### Bug Fixes

* **templates:** remove trailing spaces and tabs from all templates ([#34](https://github.com/plvo/create-faster/issues/34)) ([0ef284c](https://github.com/plvo/create-faster/commit/0ef284c61cccd5f6dd541d694e8901ea82c3df21))


### Miscellaneous

* **dev:** add local publishing test, cc skills ([362859b](https://github.com/plvo/create-faster/commit/362859b669c43504417d0504dc733d278040fe1c))

## [1.3.1](https://github.com/plvo/create-faster/compare/create-faster-v1.3.0...create-faster-v1.3.1) (2025-11-20)


### Bug Fixes

* **cli:** rm shared pkg ([bedfb41](https://github.com/plvo/create-faster/commit/bedfb41914b56253e46b4a8bb39b63ae7f20b963))

## [1.3.0](https://github.com/plvo/create-faster/compare/create-faster-v1.2.0...create-faster-v1.3.0) (2025-11-14)


### Features

* flags support ([#26](https://github.com/plvo/create-faster/issues/26)) ([d483edd](https://github.com/plvo/create-faster/commit/d483eddcedf958a95dd53787320390724d5efea1))
* **www:** init docs and showcase ([#28](https://github.com/plvo/create-faster/issues/28)) ([f465153](https://github.com/plvo/create-faster/commit/f465153e9d68cbfc9d50597e0d138a55140b43f0))

## [1.2.0](https://github.com/plvo/create-faster/compare/create-faster-v1.1.3...create-faster-v1.2.0) (2025-11-05)


### Features

* **cli:** enhance TUI and setup experience ([#22](https://github.com/plvo/create-faster/issues/22)) ([813ebac](https://github.com/plvo/create-faster/commit/813ebac432826a03c7c199fcc6a601dd13fab1fc))
* tui ([#21](https://github.com/plvo/create-faster/issues/21)) ([2b3e626](https://github.com/plvo/create-faster/commit/2b3e6267c64057964f4cf62d2097be983fc61615))


### Refactor

* **cli:** restructure metadata and update type imports ([#19](https://github.com/plvo/create-faster/issues/19)) ([e0768ca](https://github.com/plvo/create-faster/commit/e0768caa24e69bd4488659c3344f9075407e1908))
* **cli:** tui, progress component, summary ([#24](https://github.com/plvo/create-faster/issues/24)) ([3c18a08](https://github.com/plvo/create-faster/commit/3c18a086db929f6bda550008c1f61957194739d2))


### Miscellaneous

* change operation canceled messages ([#25](https://github.com/plvo/create-faster/issues/25)) ([203ad4e](https://github.com/plvo/create-faster/commit/203ad4ef33444356341130fd83b7f16eaca31927))

## [1.1.3](https://github.com/plvo/create-faster/compare/create-faster-v1.1.2...create-faster-v1.1.3) (2025-10-30)


### Bug Fixes

* **cli:** pkg build and templates path ([5e2330a](https://github.com/plvo/create-faster/commit/5e2330ac08c02329aa99f4349f080d38df1d1155))

## [1.1.2](https://github.com/plvo/create-faster/compare/create-faster-v1.1.0...create-faster-v1.1.2) (2025-10-27)


### Refactor

* **ci:** update release workflow and enhance CLI functionality ([aa8581c](https://github.com/plvo/create-faster/commit/aa8581c6050f91f156d9e8356f9509e6011d9ab7))

## [1.1.0](https://github.com/plvo/create-faster/compare/create-faster-v1.0.0...create-faster-v1.1.0) (2025-10-26)


### Features

* **nextjs:** enhance base templates, tanstack-query ([#14](https://github.com/plvo/create-faster/issues/14)) ([a8af35c](https://github.com/plvo/create-faster/commit/a8af35c60ff453658c92d22144cdef61fd2a9da3))
* **template:** Expo and Hono ([#16](https://github.com/plvo/create-faster/issues/16)) ([46acee5](https://github.com/plvo/create-faster/commit/46acee542bb753d20484853ddd70528fdbaba143))

## 1.0.0 (2025-10-24)


### Features

* creaaateeee fasteeeeeeer ([ecade7a](https://github.com/plvo/create-faster/commit/ecade7acc565ad0085c3a6d5f7aa8bfa014c2067))
* implement context-aware filtering and enhance CLI prompts ([#3](https://github.com/plvo/create-faster/issues/3)) ([a5df6bd](https://github.com/plvo/create-faster/commit/a5df6bd41b31ea6a1103c2f9dea65136c6b9e890))
* **modules:** nextjs pwa ([4c2283d](https://github.com/plvo/create-faster/commit/4c2283d58b51476ececa6b1c5b4c7a904d7297fb))
* nextjs better-auth module ([#5](https://github.com/plvo/create-faster/issues/5)) ([e117dac](https://github.com/plvo/create-faster/commit/e117dacaf8e9e13ec537d7caf62c89375f4454ff))
* template and cli core logic ([#1](https://github.com/plvo/create-faster/issues/1)) ([ba15574](https://github.com/plvo/create-faster/commit/ba155742e107b32aa755dd523d5610207c7db96f))
* templates, modules, magic comments ([#4](https://github.com/plvo/create-faster/issues/4)) ([3bff411](https://github.com/plvo/create-faster/commit/3bff411c8c34c97d83a8be030a5dceb7fab19ca4))


### Bug Fixes

* **gha:** correct release-please config to track apps/cli ([17fbfe4](https://github.com/plvo/create-faster/commit/17fbfe41e666c6abc510ca4ac6928572197debd7))
* **modules:** mdx ([74f0d91](https://github.com/plvo/create-faster/commit/74f0d915f12169180da216833a13889aadb904ef))


### Refactor

* enhance CLI functionality and update dependencies ([6e490ad](https://github.com/plvo/create-faster/commit/6e490ad9709bddcc3f4688caa6433a2f30c34fa0))
