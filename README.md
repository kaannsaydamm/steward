<div align="center">

<img src="src/browser/assets/logos/white-steward.svg" alt="Steward logo" width="280" />

# Steward

**Parallel agentic development workspace for desktop and browser**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-coder%2Fmux-5c6ac4)](https://github.com/coder/mux)

[English](#english) · [Türkçe](#türkçe) · [Русский](#русский) · [Français](#français) · [Deutsch](#deutsch) · [Español](#español)

</div>

## English

Steward lets you plan and execute software tasks with multiple AI agents on local folders, isolated Git worktrees, or remote SSH machines. It combines parallel workspaces, code review, terminal access, browser sessions, workflows, skills, MCP tools, cost tracking, and responsive server mode in one application.

Steward is a modified fork of [Coder Mux](https://github.com/coder/mux). It preserves upstream compatibility where that prevents breaking existing workflows, while using the Steward name, command, deep link, and `~/.steward/app` data directory. The legacy `mux` command, `mux://` links, `MUX_ROOT`, and an existing `~/.mux` directory remain supported for migration.

### Features

- Parallel agents with Plan, Exec, and compaction modes
- Local folders, isolated Git worktrees, and SSH runtimes
- Anthropic, OpenAI, Google, xAI, DeepSeek, OpenRouter, Amazon Bedrock, Ollama, and custom OpenAI-compatible providers
- Visual workflow editor, reusable skills, MCP servers, and agent delegation
- Integrated terminal, browser preview, code review, Git status, and usage tracking
- Desktop application plus responsive authenticated server mode
- ACP integration for compatible editors

### Run from source

Prerequisites: Git, [Bun](https://bun.sh/), and GNU Make.

```bash
git clone https://github.com/kaannsaydamm/steward.git
cd steward
bun install
make dev
```

Build and verify:

```bash
make typecheck
make test
make build
```

After a build, the CLI entry point is `steward`; `mux` remains a compatibility alias. Provider credentials and other persistent application data are stored under `~/.steward/app` by default. Set `STEWARD_ROOT` to override that location.

The inherited feature documentation is currently available in [`docs/`](docs/) and at the [upstream Mux documentation](https://mux.coder.com/). References to Mux Gateway and Mux Governor identify Coder-operated services and are intentionally unchanged.

## Türkçe

Steward; yerel klasörlerde, izole Git worktree'lerinde veya SSH makinelerinde birden fazla AI agent ile paralel yazılım geliştirme ortamıdır. Terminal, tarayıcı, kod inceleme, workflow, skill, MCP, model sağlayıcıları ve maliyet takibini tek masaüstü/web arayüzünde birleştirir.

Proje, [Coder Mux](https://github.com/coder/mux) tabanlı değiştirilmiş bir AGPL forkudur. Ana komut `steward`, veri dizini `~/.steward/app` ve deep link şeması `steward://` olurken eski Mux kurulumları geçiş amacıyla desteklenir. Kaynaktan çalıştırmak için yukarıdaki İngilizce bölümdeki komutları kullanın.

## Русский

Steward — настольная и браузерная среда для параллельной разработки с несколькими AI-агентами. Она объединяет изолированные Git worktree, SSH, терминал, браузер, проверку кода, workflows, skills, MCP, провайдеры моделей и учет расходов.

Это модифицированный AGPL-форк [Coder Mux](https://github.com/coder/mux). Основная команда — `steward`, каталог данных — `~/.steward/app`, схема ссылок — `steward://`; совместимость со старыми установками Mux сохранена для миграции.

## Français

Steward est un espace de développement desktop et web permettant d'exécuter plusieurs agents IA en parallèle. Il réunit worktrees Git isolés, SSH, terminal, navigateur, revue de code, workflows, skills, MCP, fournisseurs de modèles et suivi des coûts.

Il s'agit d'un fork AGPL modifié de [Coder Mux](https://github.com/coder/mux). La commande principale est `steward`, les données sont stockées dans `~/.steward/app` et les liens utilisent `steward://`; la compatibilité Mux est conservée pour la migration.

## Deutsch

Steward ist eine Desktop- und Browser-Arbeitsumgebung für parallele Softwareentwicklung mit mehreren KI-Agenten. Sie vereint isolierte Git-Worktrees, SSH, Terminal, Browser, Code-Review, Workflows, Skills, MCP, Modellanbieter und Kostenübersicht.

Steward ist ein modifizierter AGPL-Fork von [Coder Mux](https://github.com/coder/mux). Der Hauptbefehl lautet `steward`, Daten liegen unter `~/.steward/app` und Links verwenden `steward://`; die Mux-Kompatibilität bleibt für Migrationen erhalten.

## Español

Steward es un entorno de escritorio y navegador para desarrollo paralelo con varios agentes de IA. Integra worktrees Git aislados, SSH, terminal, navegador, revisión de código, workflows, skills, MCP, proveedores de modelos y control de costes.

Es un fork AGPL modificado de [Coder Mux](https://github.com/coder/mux). El comando principal es `steward`, los datos se guardan en `~/.steward/app` y los enlaces usan `steward://`; se conserva la compatibilidad con Mux para facilitar la migración.

## Development

Contributor and repository rules are in [`docs/AGENTS.md`](docs/AGENTS.md). Bun and the Makefile are the source of truth for dependency management, tests, and builds.

## License and attribution

Copyright (C) 2026 Coder Technologies, Inc. and Steward contributors.

Steward is free software distributed under the GNU Affero General Public License version 3. See [LICENSE](LICENSE). Upstream copyright notices and attribution are retained.
