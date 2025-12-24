'use client';

import React from 'react';
import { ASCII_BASE, CLI_VERSION } from '@/lib/constants';
import { AnimatedSpan, Terminal, TypingAnimation } from './ui/terminal';

type Scenario = 'single' | 'turborepo';

interface CliDemoProps {
  scenario: Scenario;
  setScenario: (scenario: Scenario) => void;
}

export function CliDemo() {
  const [scenario, setScenario] = React.useState<Scenario>('single');

  return (
    <div
      className='w-full max-w-4xl border border-fd-accent rounded-xl mx-auto overflow-hidden
      shadow-[0_0_32px_0_rgba(0,48,255,0.1),0_0_16px_0_rgba(0,48,255,0.08)]'
    >
      <div className='relative w-full'>
        {scenario === 'single' ? (
          <SingleAppDemo scenario={scenario} setScenario={setScenario} />
        ) : (
          <MonorepoDemo scenario={scenario} setScenario={setScenario} />
        )}
      </div>
    </div>
  );
}

function SingleAppDemo({ scenario, setScenario }: CliDemoProps) {
  return (
    <Terminal
      className='max-w-full text-left'
      cliNav={<ScenarioSelector scenario={scenario} setScenario={setScenario} />}
      startOnView={false}
    >
      <TypingAnimation duration={10} className='text-blue-400 leading-tight mb-6 flex items-end'>
        $ bun create faster
      </TypingAnimation>

      <AnimatedSpan delay={2000} className='text-blue-400 leading-tight mb-6 flex items-end'>
        {ASCII_BASE}
        <span className='text-cyan-400'>{CLI_VERSION}</span>
      </AnimatedSpan>

      <AnimatedSpan>
        <CliLine
          content={<span className='bg-blue-600 text-white inline-block'>Creating a new project structure 🚀</span>}
          startLine='┌'
        />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Name of your project?' step={1} />
      <Typing content='my-awesome-app' />

      <Prompt content='How many apps do you want to create?' step={2} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content={<span className='text-gray-500 italic'>Eg: a backend + a frontend = enter 2</span>} />
        <CliLine content={<span className='text-gray-500 italic'>Only a Next.js app = enter 1</span>} />
        <CliLine content={<span className='text-gray-500 italic'>Turborepo will be used if more than one</span>} />
      </AnimatedSpan>
      <Typing content='1' />

      <Prompt content='Select the stack for my-awesome-app' step={3} />
      <AnimatedSpan>
        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Web / Mobile App</span>
        </div>
        <CliLine content='Next.js' description='(React framework with SSR)' icon='◇' />
        <CliLine content='Expo' description='(React Native framework)' icon='◇' />

        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Server / API</span>
        </div>
        <CliLine content='Hono' description='(Fast web framework)' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Do you want to add any Next.js modules to my-awesome-app?' step={4} />

      <AnimatedSpan delay={6000}>
        <CliLine content='shadcn/ui' description='(UI & Styling)' icon='◼' />
        <CliLine content='Next Themes' description='(Theme management)' icon='◼' />
        <CliLine content='better-auth' description='(Authentication)' icon='◼' />
        <CliLine content='tanstack-query' description='(Data fetching)' icon='◼' />
        <CliLine content='MDX' description='(Markdown-based content)' icon='◼' />
        <CliLine content='PWA' description='(Progressive Web App)' icon='◼' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Include a database?' step={3} />

      <AnimatedSpan delay={7000}>
        <CliLine content='PostgreSQL' description='(Relational database)' icon='◇' />
        <CliLine content='MySQL' description='(Relational database)' icon='◇' />
        <CliLine content='None' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Configure an ORM?' step={3} />

      <AnimatedSpan delay={8000}>
        <CliLine content='Drizzle' description='(Lightweight TypeScript ORM)' icon='◇' />
        <CliLine content='Prisma' description='(Type-safe ORM with migrations)' icon='◇' />
        <CliLine content='None' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Initialize Git?' step={4} />
      <Typing content='Yes' />

      <Prompt content='Add any extras?' step={4} />

      <AnimatedSpan className='text-gray-400'>
        <CliLine content='Biome' description='(Fast linter & formatter)' icon='◼' />
        <CliLine content='Husky' description='(Git hooks for quality checks)' icon='◼' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Install dependencies now?' step={5} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content='Install with bun' icon='◇' />
        <CliLine content='Install with pnpm' icon='◇' />
        <CliLine content='Install with npm' icon='◇' />
        <CliLine content='Skip installation' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <AnimatedSpan className='text-green-600 dark:text-green-400'>
        <CliLine content='Created 47 files' icon='✓' startLine='◇' />
        <span className='text-gray-400'>│</span>
        <CliLine content='Initialized Git repository' icon='✓' startLine='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <AnimatedSpan>
        <span className='text-gray-400'>
          {`◇  📂 Structure Summary ────────────────╮
│                                        │
│  📦 my-awesome-app/                   │
│  ├─ 📁 src/ (Next.js + 6 modules)     │
│  └─ ⚙️  Git, Biome, Husky             │
│                                        │
├────────────────────────────────────────╯
│
◇  💡 Next steps ─────────────────────────────────╮
│                                                  │
│  cd my-awesome-app                               │
│                                                  │
│  # Development:                                  │
│  bun run dev        # Start development server   │
│                                                  │
│  # Build:                                        │
│  bun run build      # Build for production       │
│                                                  │
│  # Git:                                          │
│  git remote add origin <your-repo-url>           │
│  git push -u origin main                         │
│                                                  │
├──────────────────────────────────────────────────╯
`}
        </span>
      </AnimatedSpan>

      <AnimatedSpan>
        <CliLine
          content={
            <span className='bg-cyan-400 text-black inline-block mt-3 font-bold'>
              🚀 Project created successfully at my-awesome-app!
            </span>
          }
          startLine='└'
        />
      </AnimatedSpan>

      <AnimatedSpan>
        <TypingAnimation duration={10} className='text-cyan-600 dark:text-cyan-400 pt-6'>
          $ ls ./my-awesome-app
        </TypingAnimation>

        <CliLine
          content={`
biome.json          bun.lock       drizzle.config.ts  next.config.ts      package.json  public   src
docker.compose.yml  next-env.d.ts  node_modules       postcss.config.mjs  scripts       tsconfig.json
  `}
          startLine={null}
        />
      </AnimatedSpan>
    </Terminal>
  );
}

function MonorepoDemo({ scenario, setScenario }: CliDemoProps) {
  return (
    <Terminal
      className='max-w-full text-left'
      cliNav={<ScenarioSelector scenario={scenario} setScenario={setScenario} />}
    >
      <TypingAnimation duration={10} className='text-blue-400 leading-tight mb-6 flex items-end'>
        $ bun create faster
      </TypingAnimation>

      <AnimatedSpan delay={2000} className='text-blue-400 leading-tight mb-6 flex items-end'>
        {ASCII_BASE}
        <span className='text-cyan-400'>{CLI_VERSION}</span>
      </AnimatedSpan>

      <AnimatedSpan>
        <CliLine
          content={<span className='bg-blue-600 text-white inline-block'>Creating a new project structure 🚀</span>}
          startLine='┌'
        />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Name of your project?' step={1} />
      <Typing content='my-saas-project' />

      <Prompt content='How many apps do you want to create?' step={2} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content={<span className='text-gray-500 italic'>Eg: a backend + a frontend = enter 2</span>} />
        <CliLine content={<span className='text-gray-500 italic'>Only a Next.js app = enter 1</span>} />
        <CliLine content={<span className='text-gray-500 italic'>Turborepo will be used if more than one</span>} />
      </AnimatedSpan>
      <Typing content='3' />

      {/* App #1 - Next.js */}
      <Prompt content='Name of the app #1?' step={2} />
      <Typing content='web' />

      <Prompt content='Select the stack for web' step={2} />
      <AnimatedSpan>
        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Web / Mobile App</span>
        </div>
        <CliLine content='Next.js' description='(React framework with SSR)' icon='◇' />
        <CliLine content='Expo' description='(React Native framework)' icon='◇' />

        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Server / API</span>
        </div>
        <CliLine content='Hono' description='(Fast web framework)' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Do you want to add any Next.js modules to web?' step={2} />
      <AnimatedSpan>
        <CliLine content='shadcn/ui' description='(UI & Styling)' icon='◼' />
        <CliLine content='tanstack-query' description='(Data fetching)' icon='◼' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* App #2 - Expo */}
      <Prompt content='Name of the app #2?' step={2} />
      <Typing content='mobile' />

      <Prompt content='Select the stack for mobile' step={2} />
      <AnimatedSpan>
        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Web / Mobile App</span>
        </div>
        <CliLine content='Next.js' description='(React framework with SSR)' icon='◇' />
        <CliLine content='Expo' description='(React Native framework)' icon='◇' />

        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Server / API</span>
        </div>
        <CliLine content='Hono' description='(Fast web framework)' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Do you want to add any Expo modules to mobile?' step={2} />
      <AnimatedSpan>
        <CliLine content='NativeWind' description='(UI & Styling)' icon='◼' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* App #3 - Hono */}
      <Prompt content='Name of the app #3?' step={2} />
      <Typing content='api' />

      <Prompt content='Select the stack for api' step={2} />
      <AnimatedSpan>
        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Web / Mobile App</span>
        </div>
        <CliLine content='Next.js' description='(React framework with SSR)' icon='◇' />
        <CliLine content='Expo' description='(React Native framework)' icon='◇' />

        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>├</span>
          <span className='underline font-bold'>Server / API</span>
        </div>
        <CliLine content='Hono' description='(Fast web framework)' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Do you want to add any Hono modules to api?' step={2} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content='(no modules selected)' icon='◻' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* Database & ORM */}
      <Prompt content='Include a database?' step={3} />
      <AnimatedSpan>
        <CliLine content='PostgreSQL' description='(Relational database)' icon='◇' />
        <CliLine content='MySQL' description='(Relational database)' icon='◇' />
        <CliLine content='None' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Configure an ORM?' step={3} />
      <AnimatedSpan>
        <CliLine content='Drizzle' description='(Lightweight TypeScript ORM)' icon='◇' />
        <CliLine content='Prisma' description='(Type-safe ORM with migrations)' icon='◇' />
        <CliLine content='None' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* Git & Extras */}
      <Prompt content='Initialize Git?' step={4} />
      <Typing content='Yes' />

      <Prompt content='Add any extras?' step={4} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content='Biome' description='(Fast linter & formatter)' icon='◼' />
        <CliLine content='Husky' description='(Git hooks for quality checks)' icon='◼' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* Package manager */}
      <Prompt content='Install dependencies now?' step={5} />
      <AnimatedSpan className='text-gray-400'>
        <CliLine content='Install with bun' icon='◇' />
        <CliLine content='Install with pnpm' icon='◇' />
        <CliLine content='Install with npm' icon='◇' />
        <CliLine content='Skip installation' icon='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* Results */}
      <AnimatedSpan className='text-green-600 dark:text-green-400'>
        <CliLine content='Created 142 files' icon='✓' startLine='◇' />
        <span className='text-gray-400'>│</span>
        <CliLine content='Initialized Git repository' icon='✓' startLine='◇' />
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      {/* Structure Summary */}
      <AnimatedSpan delay={20000}>
        <span className='text-gray-400'>
          {`◇  📂 Structure Summary ────────────────╮
│                                        │
│  📦 my-saas-project/                   │
│  ├─ 🚀 apps/                           │
│  │  ├─ web/ (Next.js +2 modules)       │
│  │  ├─ mobile/ (Expo +1 module)        │
│  │  └─ api/ (Hono)                     │
│  ├─ 📦 packages/                       │
│  │  └─ db/ (Drizzle + PostgreSQL)      │
│  └─ ⚙️  Turborepo, Git, Biome, Husky   │
│                                        │
├────────────────────────────────────────╯
│
◇  💡 Next steps ─────────────────────────────────╮
│                                                  │
│  cd my-saas-project                              │
│                                                  │
│  # Development:                                  │
│  bun run dev        # Start development server   │
│                                                  │
│  # Build:                                        │
│  bun run build      # Build for production       │
│                                                  │
│  # Git:                                          │
│  git remote add origin <your-repo-url>           │
│  git push -u origin main                         │
│                                                  │
├──────────────────────────────────────────────────╯
`}
        </span>
      </AnimatedSpan>

      {/* Outro */}
      <AnimatedSpan>
        <CliLine
          content={
            <span className='bg-cyan-400 text-black inline-block mt-3 font-bold'>
              🚀 Project created successfully at my-saas-project!
            </span>
          }
          startLine='└'
        />
      </AnimatedSpan>

      <AnimatedSpan>
        <TypingAnimation delay={0} duration={10} className='text-cyan-600 dark:text-cyan-400 pt-6'>
          $ ls ./my-saas-project
        </TypingAnimation>

        <CliLine
          content={`
apps          biome.json     bun.lock       node_modules    package.json  turbo.json
packages      .gitignore     .husky         tsconfig.json
          `}
          startLine={null}
        />
      </AnimatedSpan>
    </Terminal>
  );
}

function ScenarioSelector({ scenario, setScenario }: CliDemoProps) {
  return (
    <div className='flex max-sm:flex-col justify-between gap-2 h-8'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2'>
          <div className='size-2 rounded-full bg-red-500'></div>
          <div className='size-2 rounded-full bg-yellow-500'></div>
          <div className='size-2 rounded-full bg-green-500'></div>
        </div>
        <p className='text-gray-400 text-sm flex items-center mr-2'>
          {scenario === 'single'
            ? 'Initializing a single Next.js app'
            : 'Initializing a complete project with a Next.js, Expo and Hono app'}
        </p>
      </div>

      <div className='flex max-sm:justify-end gap-2'>
        <button
          type='button'
          onClick={() => setScenario('single')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors h-8 ${
            scenario === 'single' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Single App
        </button>
        <button
          type='button'
          onClick={() => setScenario('turborepo')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors h-8 ${
            scenario === 'turborepo' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Monorepo
        </button>
      </div>
    </div>
  );
}

function Prompt({ content, step }: { content: string; step: 1 | 2 | 3 | 4 | 5 }) {
  const stepString = `[ ${'◆'.repeat(step)}${' ○'.repeat(5 - step)} ] ${step}/5 ${step * 20}%`;
  return (
    <AnimatedSpan className='flex items-center gap-2'>
      <span className='text-cyan-600 dark:text-cyan-400'>◆</span> {content}{' '}
      <span className='text-blue-400'>{stepString}</span>
    </AnimatedSpan>
  );
}

function CliLine({
  content,
  description,
  icon,
  startLine = '│',
}: {
  content: React.ReactNode;
  description?: string;
  icon?: '◼' | '◇' | '◻' | '✓';
  startLine?: '◇' | '├' | '│' | '└' | '┌' | null;
}) {
  return (
    <AnimatedSpan className='flex items-center gap-2'>
      {startLine && <span className='text-gray-400'>{startLine}</span>}
      {icon && <span className='text-green-600 dark:text-green-400'>{icon}</span>} {content}{' '}
      {description && <span className='text-gray-500'>{description}</span>}
    </AnimatedSpan>
  );
}

function Typing({ content }: { content: string }) {
  return (
    <AnimatedSpan>
      <div className='flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <TypingAnimation className='text-green-600 dark:text-green-400'>{content}</TypingAnimation>
      </div>
      <span className='text-gray-400'>│</span>
    </AnimatedSpan>
  );
}
