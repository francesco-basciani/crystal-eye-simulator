# Crystal Eye Simulator

Interactive orbital simulator for the Crystal Eye detector, including its
pixel response, Earth albedo, Sun and Moon interference, and gamma ray bursts.

## Live Demo

[Open the public simulator on GitHub Pages](https://francesco-basciani.github.io/crystal-eye-simulator/)

The project is also available on the
[private project deployment](https://crystal-eye-orbit-sim.francesco-basciani.chatgpt.site/).
Every push to `main` automatically updates the public GitHub Pages demo.

## How to Run Locally

Prerequisite: Node.js `>=22.13.0`.

```bash
git clone git@github.com:francesco-basciani/crystal-eye-simulator.git
cd crystal-eye-simulator
npm install
npm run dev
```

Open the URL printed in the terminal, normally `http://localhost:3000`.
Press `Ctrl+C` in the terminal to stop the development server.

## Collaborating

Create a dedicated branch before starting a change:

```bash
git switch -c feature/your-change
```

Push the branch to GitHub and open a Pull Request targeting `main`.

## Tooling

The simulator uses:

- [Next.js](https://nextjs.org/) and React for the application interface
- [vinext](https://github.com/cloudflare/vinext) and Vite for the development
  and production build
- [Three.js](https://threejs.org/) for the interactive 3D scene
- [Astronomy Engine](https://github.com/cosinekitty/astronomy) for Sun and Moon
  ephemerides
- TypeScript and ESLint for source quality

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: create and validate the production build
- `npm run build:pages`: create the static GitHub Pages build in `out`
- `npm run start`: serve the production build locally
- `npm run lint`: run the source checks
