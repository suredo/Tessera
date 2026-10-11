---
type: Product
title: "Product"
description: "What Tessera is, who it is for, the first release's goals and what it leaves out."
tags: [product]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-11T20:21:39Z }
---
# Product

## What it is

**An environment where people get the interface they need, either by creating it now or by opening one they saved.**

It is a local-first web app where a person describes what they need in everyday words. The app builds a working tool for them inside the conversation, for example a planner, a board, a study helper, a calculator or a simulation. The person then keeps using and changing it, either by talking or by using the tool's own controls. Both act on the same saved data.

Tools are real generated code (HTML, CSS, JavaScript) running in a sandbox. They are not templates filled in. Saved tools can be reopened without calling a model.

**The product ships no tools.** There are no built-in tools, templates, examples or default apps. Every tool exists because the person asked for it, and a person's first interaction is always creating a tool. The product's job is the lifecycle around that: **create, edit, save, update, reopen, undo**. Curated examples, sets of tools, capabilities or micro-apps may come later, and so may a tool store ("check the store before generating"). None is part of the first release, and nothing in the design may assume one exists.

## Who it is for

A person with general knowledge who wants to get something done. They are not a developer. They don't know words like "state", "schema", "component" or "engine", and they shouldn't need to.

Implications:
- Requests arrive in natural language, in any phrasing, in the person's language. There are no command prefixes to learn.
- Tools must be useful right away, not empty forms that need setup first (`UX-01`).
- Messages are plain, short and honest (`GEN-12`, `UX-03`).

The first release's actual users are the product owner and testers (A29). The design still serves the non-technical person, and an installer comes later.

## Goals for the first release

1. Create a useful tool from one everyday request, starting from nothing.
2. Change it reliably, in looks, behavior or data, without losing anything the person did.
3. Save it, update it, reopen it, find it again by asking, and undo changes, with every version kept.
4. Keep data safe: nothing is silently lost, overwritten or invented.
5. Know when a tool works: the host verifies behavior instead of trusting the model's word.
6. Know what it cost: every model call is measured.

## Not in the first release

- Built-in tools, templates, examples or a tool store (see [What it is](#what-it-is)).
- Simulation engines, research and flow checks. They come in a later milestone (`SIM-*`, roadmap M5); the POC design is the reference.
- Model connections other than your own signed-in Claude Code and Codex CLIs: API keys, other providers (z.ai, Kimi, Grok and others) and anyone else signing in come later (`CLI-10`, A47).
- macOS, Linux, or an installer (`PLAT-01`).
- Hosting, accounts, multi-user use, sharing or a marketplace.
- Running native code, or desktop and OS overlays.
- Several tools executing at the same time (one active runtime, `RUN-02`).
- AI inside tools, such as a tool calling a model itself (`CAP-05`).
- A richer versioning system for tools: named versions, drafts or branches, side-by-side comparison. Besides helping people, it could let the AI work on bigger or complex changes in a draft, checked step by step, before anything replaces the live version. The first release keeps linear versions with restore (`DATA-04`, `APP-05`).
