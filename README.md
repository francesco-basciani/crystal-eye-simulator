# Crystal Eye Simulator

Simulatore interattivo del rivelatore Crystal Eye in orbita terrestre, con
visualizzazione dei pixel, albedo della Terra, Sole, Luna e gamma ray burst.

## Demo online

[Apri il simulatore](https://crystal-eye-orbit-sim.francesco-basciani.chatgpt.site/)

> La demo può richiedere l’accesso autorizzato dal proprietario.

## Avvio locale

Requisito: [Node.js](https://nodejs.org/) 22.13 o successivo.

```bash
git clone git@github.com:francesco-basciani/crystal-eye-simulator.git
cd crystal-eye-simulator
npm install
npm run dev
```

Aprire nel browser l’indirizzo mostrato dal terminale, normalmente
`http://localhost:3000`.

Per interrompere il simulatore premere `Ctrl+C` nel terminale.

## Controllo della build

```bash
npm run build
```

## Collaborare

Creare un branch dedicato prima di iniziare una modifica:

```bash
git switch -c feature/nome-modifica
```

Al termine, pubblicare il branch su GitHub e aprire una Pull Request verso
`main`.
