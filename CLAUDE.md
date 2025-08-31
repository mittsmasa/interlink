# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm dev` - Start development server with Turbopack
- `pnpm build` - Build the project with Turbopack  
- `pnpm start` - Start production server
- `pnpm lint` - Run Biome linter checks
- `pnpm format` - Format code with Biome

## Project Architecture

This is a Next.js 15.5.2 project using the App Router architecture with TypeScript and Tailwind CSS v4.

### Stack
- **Framework**: Next.js 15 with App Router and Turbopack
- **Language**: TypeScript with strict configuration
- **Styling**: Tailwind CSS v4 with PostCSS
- **Linting/Formatting**: Biome (replaces ESLint + Prettier)
- **Package Manager**: pnpm

### Directory Structure
- `src/app/` - App Router pages and layouts
- `src/app/layout.tsx` - Root layout with Japanese locale (`lang="ja"`)
- `src/app/page.tsx` - Home page component

### Key Configurations
- TypeScript uses path mapping with `@/*` for `./src/*`
- Biome configured for React/Next.js with recommended rules
- Tailwind CSS v4 integrated via PostCSS
- Strict TypeScript settings enabled