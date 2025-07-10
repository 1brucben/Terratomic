# 🌎 Terratomic.io

[![Join Discord](https://img.shields.io/discord/1380341945603330148?label=Join%20Us%20on%20Discord&logo=discord&style=for-the-badge)](https://discord.gg/JNZbp4pg5y)

**Terratomic.io** is a fast-paced real-time strategy game focused on **territorial conquest**, **alliance-building**, and **resource management**.

It is a fork of [OpenFront.io](https://github.com/openfrontio/OpenFrontIO), which itself is based on [WarFront.io](https://github.com/WarFrontIO).

## 💬 Why This Fork

While OpenFront laid a strong foundation, Terratomic takes a different approach — placing community feedback and collaborative development at the core of its roadmap.

This project aims to evolve based on what players actually want, with transparent priorities and active community input shaping the game's future.

This is a game built _with_ its players, not just _for_ them.

## 🤝 Contributing

Whether you're here to squash bugs, prototype new mechanics, or improve the UI, here's how to get started:

```bash
git clone https://github.com/1brucben/Terratomic.git
cd Terratomic
npm install
npm run dev
```

You're now ready to start developing locally. A formal contribution guide will be published soon.

Until then, open issues, submit pull requests or join the discussion [on Discord](https://discord.gg/JNZbp4pg5y) — we're listening.

## 🗂️ Project Structure

- `src/client` – Game frontend (components, graphics, styles, utilities)
- `src/core` – Shared game logic (execution, game state, pathfinding, validations)
- `src/server` – Backend services (session control, matchmaking, gatekeeping)
- `src/scripts` – Dev or build-time scripts
- `resources/` – Static assets (flags, fonts, icons, maps, sprites, images)
- `tests/` – Unit and integration tests for client, core logic, and utilities

## 🛠 Licensing

Terratomic is a fork of [OpenFront.io](https://github.com/openfrontio/OpenFrontIO), which was originally licensed under a combination of GPLv3 (for `src/client`) and MIT (for the rest of the code). That project did not include license headers in individual files.

As part of this fork, we have **unified the license under GPLv3** for all parts of the project, **except** the `proprietary/` folder, which is governed by a separate proprietary license and a Contributor License Agreement (CLA).

### 📂 Folder Licensing Summary

- `src/client`, `src/core`, `src/server`, `src/scripts`, `tests/`: **GPLv3**
- `resources/`: **GPLv3**
- `proprietary/`: **Proprietary** – See [CLA.md](./CLA.md) for contributor terms

Some third-party files may retain their original licenses (e.g. MIT); where applicable, these are noted in headers or accompanying files.

© 2025 Terratomic Team
