'use client';

import { useState } from 'react';
import { AnimatedSpan, Terminal, TypingAnimation } from '@/components/ui/shadcn-io/terminal';

type Scenario = 'single' | 'turborepo';

export function CliDemo() {
  const [scenario, setScenario] = useState<Scenario>('single');

  return (
    <div className='relative w-full'>
      <Terminal className='max-h-[600px] w-full max-w-full overflow-auto text-xs'>
        {scenario === 'single' ? <SingleAppScenario /> : <TurborepoScenario />}
      </Terminal>

      {/* Boutons de sélection */}
      <div className='absolute bottom-4 right-4 flex gap-2 z-10'>
        <button
          type='button'
          onClick={() => setScenario('single')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            scenario === 'single' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Single App
        </button>
        <button
          type='button'
          onClick={() => setScenario('turborepo')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            scenario === 'turborepo' ? 'bg-cyan-400 text-black' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Monorepo
        </button>
      </div>
    </div>
  );
}

function Prompt({ content, step, delay }: { content: string; step: 1 | 2 | 3 | 4 | 5; delay: number }) {
  const stepString = `[ ${'◆'.repeat(step)}${' ○'.repeat(5 - step)} ] ${step}/5 ${step * 20}%`;
  return (
    <AnimatedSpan delay={delay} className='flex items-center gap-2'>
      <span className='text-cyan-400'>◆</span> {content} <span className='text-blue-400'>{stepString}</span>
    </AnimatedSpan>
  );
}

function Typing({ content, delay }: { content: string; delay: number }) {
  return (
    <AnimatedSpan delay={delay}>
      <div className='flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <TypingAnimation delay={1400} duration={40} className='text-green-400'>
          {content}
        </TypingAnimation>
      </div>
      <span className='text-gray-400'>│</span>
    </AnimatedSpan>
  );
}

const INTRO_ASCII = `
 	                    __             ____           __           
  _____________  ____ _/ /____        / __/___ ______/ /____  _____
 / ___/ ___/ _ \\/ __ \`/ __/ _ \\______/ /_/ __ \`/ ___/ __/ _ \\/ ___/
/ /__/ /  /  __/ /_/ / /_/  __/_____/ __/ /_/ (__  ) /_/  __/ /    
\\___/_/   \\___/\\__,_/\\__/\\___/     /_/  \\__,_/____/\\__/\\___/_/  1.2.0
`;

function SingleAppScenario() {
  return (
    <div className='w-full text-left'>
      {/* Command */}
      <AnimatedSpan delay={0} className='text-cyan-400'>
        $ bunx create-faster
      </AnimatedSpan>

      {/* ASCII Art Logo */}
      <AnimatedSpan delay={300} className='text-blue-400 leading-tight mt-2'>
        {INTRO_ASCII}
      </AnimatedSpan>

      <AnimatedSpan delay={800} className='bg-blue-600 text-white px-2 py-0.5 inline-block my-4'>
        Creating a new project structure 🚀
      </AnimatedSpan>

      <Prompt content='Name of your project?' step={1} delay={1250} />
      <Typing content='my-awesome-app' delay={1250} />

      <Prompt content='How many apps do you want to create?' step={2} delay={1900} />

      <AnimatedSpan delay={2200} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Eg: a backend + a frontend = enter 2</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2200} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Only a Next.js app = enter 1</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2200} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Turborepo will be used if more than one</span>
      </AnimatedSpan>

      <Typing content='1' delay={2450} />

      <Prompt content='Select the stack for my-awesome-app' step={3} delay={2450} />

      <AnimatedSpan delay={2850} className='flex items-center gap-2'>
        <span className='text-gray-400'>├</span>
        <span className='underline font-bold'>Web / Mobile App</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2900} className='flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Next.js{' '}
        <span className='text-gray-500'>(React framework with SSR)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2950} className='flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Expo
      </AnimatedSpan>
      <AnimatedSpan delay={3050} className='flex items-center gap-2'>
        <span className='text-gray-400'>├</span>
        <span className='underline font-bold'>Server / API</span>
      </AnimatedSpan>
      <AnimatedSpan delay={3100}>
        <div className='flex items-center gap-2'>
          <span className='text-gray-400'>│</span>
          <span className='text-green-400'>◇</span> Hono
        </div>
        <span className='text-gray-400'>│</span>
      </AnimatedSpan>

      <Prompt content='Do you want to add any Next.js modules to my-awesome-app?' step={4} delay={3500} />

      <AnimatedSpan delay={3600} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={3650} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◼</span> shadcn/ui <span className='text-gray-500'>(UI & Styling)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={3700} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◼</span> better-auth <span className='text-gray-500'>(Authentication)</span>
      </AnimatedSpan>

      {/* Database */}
      <AnimatedSpan delay={4200} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Include a database?' step={3} delay={4250} />
      <AnimatedSpan delay={4300} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={4350} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> PostgreSQL{' '}
        <span className='text-gray-500'>(Relational database)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={4400} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> MySQL
      </AnimatedSpan>
      <AnimatedSpan delay={4450} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> None
      </AnimatedSpan>

      {/* ORM */}
      <AnimatedSpan delay={4900} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Configure an ORM?' step={3} delay={4950} />
      <AnimatedSpan delay={5000} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={5050} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Drizzle{' '}
        <span className='text-gray-500'>(Lightweight TypeScript ORM)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={5100} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Prisma
      </AnimatedSpan>
      <AnimatedSpan delay={5150} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> None
      </AnimatedSpan>

      {/* Git */}
      <AnimatedSpan delay={5600} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Initialize Git?' step={4} delay={5650} />
      <AnimatedSpan delay={5700} className='text-gray-400'>
        │
      </AnimatedSpan>
      <TypingAnimation delay={5800} duration={50} className='text-green-400'>
        Yes
      </TypingAnimation>

      {/* Extras */}
      <AnimatedSpan delay={6100} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Add any extras?' step={4} delay={6150} />
      <AnimatedSpan delay={6200} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={6250} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◼</span> Biome
      </AnimatedSpan>
      <AnimatedSpan delay={6300} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◼</span> Husky
      </AnimatedSpan>

      {/* Package Manager */}
      <AnimatedSpan delay={6800} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Install dependencies now?' step={5} delay={6850} />
      <AnimatedSpan delay={6900} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={6950} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with bun
      </AnimatedSpan>
      <AnimatedSpan delay={7000} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with pnpm
      </AnimatedSpan>
      <AnimatedSpan delay={7050} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with npm
      </AnimatedSpan>
      <AnimatedSpan delay={7100} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Skip installation
      </AnimatedSpan>

      {/* Generation */}
      <AnimatedSpan delay={7600} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={7650} className='text-green-400'>
        <span className='text-green-400'>◇</span> Generating project files...
      </AnimatedSpan>
      <AnimatedSpan delay={8100} className='text-green-400'>
        ✓ Created 47 files
      </AnimatedSpan>
      <AnimatedSpan delay={8600} className='text-green-400'>
        ✓ Initialized Git repository
      </AnimatedSpan>
      <AnimatedSpan delay={9100} className='text-green-400'>
        ✓ Installing dependencies with bun...
      </AnimatedSpan>

      {/* Summary */}
      <AnimatedSpan delay={9600} className='mt-3 border border-gray-600 p-2 rounded'>
        <span className='font-bold'>📂 Summary</span>
        <br />
        <br />
        <span className='font-bold text-white'>#🏠 Structure:</span>
        <br />
        <br />
        <span>📦 </span>
        <span className='font-bold text-cyan-400'>my-awesome-app/</span>
        <br />
        <span>├─ 📁 src/ </span>
        <span className='text-yellow-400'>(Next.js +2 modules)</span>
        <br />
        <span>└─ ⚙️ </span>
        <span className='text-gray-400'>Git, Biome, Husky</span>
        <br />
        <br />
        <span className='font-bold text-white'>#💡 Next steps:</span>
        <br />
        <br />
        <span>cd my-awesome-app</span>
        <br />
        <br />
        <span># Development:</span>
        <br />
        <span>bun run dev # Start development server</span>
        <br />
        <br />
        <span># Build:</span>
        <br />
        <span>bun run build # Build for production</span>
        <br />
        <br />
        <span># Git:</span>
        <br />
        <span>git remote add origin &lt;your-repo-url&gt;</span>
        <br />
        <span>git push -u origin main</span>
      </AnimatedSpan>

      {/* Outro */}
      <AnimatedSpan delay={10100} className='bg-cyan-400 text-black px-2 py-1 inline-block mt-3 font-bold'>
        🚀 Project created successfully at /home/user/my-awesome-app!
      </AnimatedSpan>
    </div>
  );
}

function TurborepoScenario() {
  return (
    <div className='w-full text-left'>
      {/* Command */}
      <AnimatedSpan delay={0} className='text-cyan-400'>
        $ bunx create-faster
      </AnimatedSpan>

      {/* ASCII Art Logo */}
      <AnimatedSpan delay={300} className='text-blue-400 leading-tight mt-2'>
        {INTRO_ASCII}
      </AnimatedSpan>

      {/* Intro Message */}
      <AnimatedSpan delay={800} className='bg-blue-600 text-white px-2 py-0.5 inline-block mt-2'>
        Creating a new project structure 💻
      </AnimatedSpan>

      {/* Progress Bar - Project Name */}
      <AnimatedSpan delay={1200} className='text-gray-400 mt-3'>
        │
      </AnimatedSpan>
      <Prompt content='Name of your project?' step={1} delay={1250} />
      <Typing content='my-monorepo' delay={1250} />

      {/* Progress Bar - App Count */}
      <AnimatedSpan delay={1900} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='How many apps do you want to create?' step={2} delay={1950} />

      <AnimatedSpan delay={2000} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Eg: a backend + a frontend = enter 2</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2050} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Only a Next.js app = enter 1</span>
      </AnimatedSpan>
      <AnimatedSpan delay={2100} className='text-gray-400 flex items-center gap-2'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500 italic'>Turborepo will be used if more than one</span>
      </AnimatedSpan>

      <Typing content='2' delay={2150} />

      {/* App #1 Name */}
      <AnimatedSpan delay={2500} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Name of the app #1?' step={2} delay={2550} />
      <Typing content='web' delay={2550} />

      {/* App #1 Stack Selection */}
      <AnimatedSpan delay={2950} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Select the stack for web' step={2} delay={3000} />
      <AnimatedSpan delay={3050} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={3100} className='text-gray-400'>
        ├ <span className='underline font-bold'>Web / Mobile App</span>
      </AnimatedSpan>
      <AnimatedSpan delay={3150} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Next.js{' '}
        <span className='text-gray-500'>(React framework with SSR)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={3200} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Expo
      </AnimatedSpan>
      <AnimatedSpan delay={3250} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={3300} className='text-gray-400'>
        ├ <span className='underline font-bold'>Server / API</span>
      </AnimatedSpan>
      <AnimatedSpan delay={3350} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Hono
      </AnimatedSpan>

      {/* App #1 Modules */}
      <AnimatedSpan delay={3750} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Do you want to add any Next.js modules to web?' step={2} delay={3800} />
      <AnimatedSpan delay={3850} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={3900} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◼</span> shadcn/ui <span className='text-gray-500'>(UI & Styling)</span>
      </AnimatedSpan>

      {/* App #2 Name */}
      <AnimatedSpan delay={4400} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Name of the app #2?' step={2} delay={4450} />
      <Typing content='api' delay={4450} />

      {/* App #2 Stack Selection */}
      <AnimatedSpan delay={4850} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Select the stack for api' step={2} delay={4900} />
      <AnimatedSpan delay={4950} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={5000} className='text-gray-400'>
        ├ <span className='underline font-bold'>Web / Mobile App</span>
      </AnimatedSpan>
      <AnimatedSpan delay={5050} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Next.js
      </AnimatedSpan>
      <AnimatedSpan delay={5100} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Expo
      </AnimatedSpan>
      <AnimatedSpan delay={5150} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={5200} className='text-gray-400'>
        ├ <span className='underline font-bold'>Server / API</span>
      </AnimatedSpan>
      <AnimatedSpan delay={5250} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Hono <span className='text-gray-500'>(Fast web framework)</span>
      </AnimatedSpan>

      {/* App #2 Modules */}
      <AnimatedSpan delay={5650} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Do you want to add any Hono modules to api?' step={2} delay={5700} />
      <AnimatedSpan delay={5750} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={5800} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-gray-500'>No modules available</span>
      </AnimatedSpan>

      {/* Database */}
      <AnimatedSpan delay={6300} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Include a database?' step={3} delay={6350} />
      <AnimatedSpan delay={6400} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={6450} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> PostgreSQL{' '}
        <span className='text-gray-500'>(Relational database)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={6500} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> MySQL
      </AnimatedSpan>
      <AnimatedSpan delay={6550} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> None
      </AnimatedSpan>

      {/* ORM */}
      <AnimatedSpan delay={7000} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Configure an ORM?' step={3} delay={7050} />
      <AnimatedSpan delay={7100} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={7150} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Drizzle{' '}
        <span className='text-gray-500'>(Lightweight TypeScript ORM)</span>
      </AnimatedSpan>
      <AnimatedSpan delay={7200} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Prisma
      </AnimatedSpan>
      <AnimatedSpan delay={7250} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> None
      </AnimatedSpan>

      {/* Git */}
      <AnimatedSpan delay={7700} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Initialize Git?' step={4} delay={7750} />
      <AnimatedSpan delay={7800} className='text-gray-400'>
        │
      </AnimatedSpan>
      <TypingAnimation delay={7900} duration={50} className='text-green-400'>
        Yes
      </TypingAnimation>

      {/* Extras */}
      <AnimatedSpan delay={8200} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Add any extras?' step={4} delay={8250} />
      <AnimatedSpan delay={8300} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={8350} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◻</span> Biome
      </AnimatedSpan>
      <AnimatedSpan delay={8400} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◻</span> Husky
      </AnimatedSpan>

      {/* Package Manager */}
      <AnimatedSpan delay={8900} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <Prompt content='Install dependencies now?' step={5} delay={8950} />
      <AnimatedSpan delay={9000} className='text-gray-400'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={9050} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with bun
      </AnimatedSpan>
      <AnimatedSpan delay={9100} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with pnpm
      </AnimatedSpan>
      <AnimatedSpan delay={9150} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Install with npm
      </AnimatedSpan>
      <AnimatedSpan delay={9200} className='text-gray-400'>
        <span className='text-gray-400'>│</span>
        <span className='text-green-400'>◇</span> Skip installation
      </AnimatedSpan>

      {/* Generation */}
      <AnimatedSpan delay={9700} className='text-gray-400 mt-2'>
        │
      </AnimatedSpan>
      <AnimatedSpan delay={9750} className='text-green-400'>
        <span className='text-green-400'>◇</span> Generating project files...
      </AnimatedSpan>
      <AnimatedSpan delay={10250} className='text-green-400'>
        ✓ Created 89 files
      </AnimatedSpan>
      <AnimatedSpan delay={10750} className='text-green-400'>
        ✓ Initialized Git repository
      </AnimatedSpan>
      <AnimatedSpan delay={11250} className='text-green-400'>
        ✓ Installing dependencies with bun...
      </AnimatedSpan>

      {/* Summary */}
      <AnimatedSpan delay={11750} className='mt-3 border border-gray-600 p-2 rounded'>
        <span className='font-bold'>📂 Summary</span>
        <br />
        <br />
        <span className='font-bold text-white'>#🏠 Structure:</span>
        <br />
        <br />
        <span>📦 </span>
        <span className='font-bold text-cyan-400'>my-monorepo/</span>
        <br />
        <span>├─ 🚀 apps/</span>
        <br />
        <span>│ ├─ web/ </span>
        <span className='text-yellow-400'>(Next.js +1 modules)</span>
        <br />
        <span>│ └─ api/ </span>
        <span className='text-yellow-400'>(Hono)</span>
        <br />
        <span>├─ 📦 packages/</span>
        <br />
        <span>│ └─ db/ </span>
        <span className='text-magenta-400'>(Drizzle + PostgreSQL)</span>
        <br />
        <span>└─ ⚙️ </span>
        <span className='text-gray-400'>Turborepo, Git</span>
        <br />
        <br />
        <span className='font-bold text-white'>#💡 Next steps:</span>
        <br />
        <br />
        <span>cd my-monorepo</span>
        <br />
        <br />
        <span># Development:</span>
        <br />
        <span>bun run dev # Start development server</span>
        <br />
        <br />
        <span># Build:</span>
        <br />
        <span>bun run build # Build for production</span>
        <br />
        <br />
        <span># Git:</span>
        <br />
        <span>git remote add origin &lt;your-repo-url&gt;</span>
        <br />
        <span>git push -u origin main</span>
      </AnimatedSpan>

      {/* Outro */}
      <AnimatedSpan delay={12250} className='bg-cyan-400 text-black px-2 py-1 inline-block mt-3 font-bold'>
        🚀 Project created successfully at /home/user/my-monorepo!
      </AnimatedSpan>
    </div>
  );
}
