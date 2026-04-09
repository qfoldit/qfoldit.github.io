### **Gamified Quantum Molecular Design for Global Science**

[Mixed Reality Meets Quantum Science on the International Space Station](https://youtu.be/5Br-y6S4pMc) <br>
[Beyond the Code: AI 2050 | Kelly Chibale](https://youtu.be/7KmUzG1hltI) <br>
[iDMT | Cambridge](https://youtu.be/Dd7ZwpgT4nw) <br>
[H3D | Drug Discovery Platform](https://youtu.be/yYfb2_oLlVo)

![](https://qfoldit.github.io/video/qfolditdna.png)
![](https://qfoldit.github.io/img/posters/letti_letters.png)

*An open‑science partner of the [Ersilia Open Source Initiative](https://github.com/ersilia-os/) and [Visualizing biological data](https://vizbi.org/)*

![](https://qfoldit.github.io/video/Drew_Berry.png)
![](https://qfoldit.github.io/img/Westminster_Labster.png)
![](https://joyenergy.github.io/img/Professor_Chibale.png)
![](https://qfoldit.github.io/img/1/logo/syntech.png)
![](https://qfoldit.github.io/img/posters/iDMT_Center.png)
![](https://qfoldit.github.io/img/1/logo/idmt.png)
![](https://qfoldit.github.io/img/1/logo/idmt_partners.png)


[![License](https://img.shields.io/badge/License-Proprietary%20with%20Open%20Components-blue)](#) [![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://www.python.org/) [![Kubernetes](https://img.shields.io/badge/Kubernetes-1.28%2B-blue)](https://kubernetes.io/) [![Ersilia](https://img.shields.io/badge/Ersilia-Integrated-purple)](https://ersilia.io)

---

## 🧬 Mission

**qFoldIT** is a distributed, immersive platform that turns molecular design into a collaborative game. By combining quantum computing, AI‑driven screening, and citizen science, we empower researchers and players worldwide to discover new drug candidates against infectious diseases—starting with malaria, tuberculosis, and antimicrobial resistance (AMR).

We are proud to align with the **Ersilia Open Source Initiative**: we share the commitment to open, accessible AI tools for the Global South. qFoldIT extends Ersilia’s model hub with an interactive, gamified layer that scales scientific contribution to thousands of participants while maintaining rigorous open‑science principles.

---

## 🌍 Why qFoldIT ?

- **Accelerate drug discovery** – Players generate molecular structures; our AI/quantum backend evaluates them in real time.
- **Democratise science** – Free, unlimited access to the core scientific modules (folding, design) removes barriers for researchers and students.
- **Reward contribution** – Smart contracts ensure creators receive royalties (up to 30%) when their molecules are licensed by industry partners.
- **Bridge cultures** – Rooted in the Ashanti heritage (Sankofa, Gye Nyame) and designed with a flexible CBDC‑based economy, qFoldIT embodies a new model of scientific diplomacy.

---

## 🤝 Partnership with [Ersilia](https://ersilia.io/)

We are proud to be a **technology partner** of the [Ersilia Open Source Initiative](https://github.com/ersilia-os/zaira-chem). Ersilia builds the largest collection of ready‑to‑use AI models for infectious diseases. qFoldIT integrates these models into an interactive, game‑driven environment and extends them with quantum‑accelerated calculations.

| Ersilia Component | qFoldIT Integration |
|-------------------|---------------------|
| **Ersilia Model Hub** | Models are used in our `autoresearch` and `bio‑ml` services to predict ADME‑Tox, activity, and safety profiles. |
| **Isaura** (data lake) | Pre‑computed property datasets serve as benchmarks and training sources for our AI/ML pipelines. |
| **Community & training** | Our gamified interface serves as a practical tool for Ersilia’s capacity‑building workshops, helping students and researchers apply AI models hands‑on. |

Together, we are building an **open‑source ecosystem** where AI models are not only freely available but also accessible through an engaging, scalable interface—closing the gap between computational tools and real‑world drug discovery in low‑resource settings.

---

## 🏗️ Technical Architecture

![](https://qfoldit.github.io/img/posters/medChem.png)

qFoldIT follows a **microservices architecture** with containerisation (Docker) and orchestration (Kubernetes). Each service is designed to be stateless, horizontally scalable, and optimised for hybrid cloud infrastructure leveraging Singapore’s advanced computing resources.

### Core Microservices

| Service | Description | Key Libraries / Tools |
|---------|-------------|------------------------|
| `bio‑ml` | AI/ML for bio‑ and chemoinformatics | DeepFold‑PLM, DeepMol, nanoGPT‑Bio, *Ersilia models*, PyTorch, TensorFlow |
| `plant` | Digital phenotyping & plant simulation | DeepPlant, OpenAlea (L‑systems) |
| `rosetta` | Classical & quantum‑accelerated folding | Rosetta, QuPepFold, OpenMM, MDAnalysis |
| `animation` | Real‑time molecular rendering | Science in Motion, Gaussian Splatting (compute shaders) |
| `autoresearch` | Autonomous AI scientist (ZairaChem pipeline) | 15+ ADME‑Tox models, calls other services via gRPC |
| `quantum‑adapter` | Unified interface to quantum backends | Qiskit‑Aer, Singapore quantum resources (CQT, NSCC) |

### Container Orchestration

All services are packaged as Docker images and deployed on **Kubernetes** across a hybrid cloud environment that includes:

- **National Supercomputing Centre (NSCC) Singapore** – GPU‑accelerated nodes for heavy AI/quantum workloads.
- **Commercial cloud providers** (AWS, Google Cloud) – for elastic scaling of stateless services and global distribution.

We use:
- **StatefulSets** for PostgreSQL, RabbitMQ, MinIO
- **Horizontal Pod Autoscaling** for stateless services
- **GPU node pools** (NVIDIA H100/A100) for `bio‑ml`, `animation`, and `quantum‑adapter` simulations
- **ConfigMaps / Secrets** for configuration and API keys
- **Ingress** with TLS termination for external access

A simplified architecture diagram:

```
[Game Clients via Steam] → API Gateway → [Microservices] → [Quantum Backends / S3 / RabbitMQ]
                                                    ↑
                                                    └── Autoresearch (orchestrates workflows)
```

---

## ⚛️ Quantum Adapter

The `quantum‑adapter` service provides a **unified interface** for quantum computing backends, abstracting away vendor‑specific APIs. It currently supports:

- **Qiskit‑Aer** – GPU‑accelerated simulator for testing and small molecules
- **Singapore’s national quantum resources** – access to ion‑trap and superconducting quantum processors through the **Centre for Quantum Technologies (CQT)** and the **National Quantum Strategy**, enabling real VQE and optimisation runs

The adapter exposes a simple gRPC interface:

```protobuf
service QuantumAdapter {
  rpc RunVQE (VQERequest) returns (VQEResponse);
  rpc RunAnnealing (AnnealingRequest) returns (AnnealingResponse);
  rpc GetStatus (StatusRequest) returns (StatusResponse);
}
```

This design allows us to:

- Switch backends without changing client code
- Fallback to simulators when quantum hardware is unavailable
- Collect performance metrics for each backend

Integration with `rosetta` and `autoresearch` enables hybrid classical‑quantum workflows: the AI models propose molecular structures, and the quantum adapter refines their energies and conformational landscapes.

---

## 🧩 Synergistic Library Pairings (per Container)

To maximise performance and minimise dependencies, each container bundles **two complementary libraries** that share a common theme:

| Container | Library A | Library B | Rationale |
|-----------|-----------|-----------|-----------|
| `protein-dynamics` | OpenMM (MD) | MDAnalysis (trajectory analysis) | End‑to‑end MD simulation and post‑processing |
| `inference-engine` | AlphaFold3 (structure prediction) | JAX (autograd) | High‑performance inference with differentiable components |
| `quantum-simulator` | Qiskit‑Aer | CuPy (GPU arrays) | GPU‑accelerated quantum circuit simulation |
| `engine-adapter` | gRPC | Protobuf | Lightweight communication bridge to Unigine client |

This “two‑per‑pod” rule keeps images lean, reduces startup time, and simplifies dependency management.

---

## 🎮 Gamification Meets Science

qFoldIT inherits the proven citizen‑science mechanics of FoldIT but adds three transformative layers:

1. **Quantum acceleration** – players interact with models that use real quantum processors for energy calculations.
2. **Direct commercialisation** – validated molecules are registered on a private blockchain (Proof of Authority) with authorship linked to the player’s Steam ID. Smart contracts distribute royalties automatically.
3. **Psychological engagement** – the patented “Stop in Time” mechanic (RU2051730C1) lets players decide when to stop an experiment, balancing risk and reward—activating dopamine circuits and teaching decision‑making under uncertainty.

### In‑Game Economy: Photons & Energy

- **Photons** – premium currency pegged to a generic **Central Bank Digital Currency (CBDC)** framework. This provides a stable, transparent value store and can later be adapted to specific national digital currencies (e.g., eCedi, digital dollar, etc.). Photons are earned through gameplay or purchased; they are used for cosmetics, battle passes, and optional risk‑management items.
- **Energy** – limits non‑scientific activities (races, exploration). **Scientific modules (folding, design) consume no energy**, preserving the spirit of citizen science.

![](https://qfoldit.github.io/img/posters/VISUALIZING_BIOLOGICAL_DATA.png)

---

## 🔓 Open Science & Reproducibility

While the core game engine and certain proprietary components remain closed, all scientific pipelines are designed with openness in mind:

- **Models**: We use and contribute to open‑source libraries (Rosetta, OpenMM, Qiskit, Ersilia Model Hub). Any new models developed specifically for qFoldIT may be released under open licenses.
- **Data**: Anonymised molecular structures generated by players are made available for research (CC BY‑NC 4.0), with authorship preserved via blockchain.
- **Workflows**: Our `autoresearch` service is based on the open‑source ZairaChem pipeline, and we document all configurations for reproducibility.

We believe that **AI for global health must be transparent**. By partnering with Ersilia, we ensure that our tools remain accessible to researchers in low‑resource settings.

![](https://qfoldit.github.io/img/posters/cambridge_symposium.png)
![](https://qfoldit.github.io/img/rafiki.png)
![](https://qfoldit.github.io/img/posters/concept_art.png)

---

## 📊 Impact Metrics (Roadmap)

| Phase | Milestone | Target |
|-------|-----------|--------|
| MVP (0‑6 mo) | Closed beta, basic folding | 500 MAU, 50 structures/day |
| Publication (6‑12 mo) | Article in Oxford/Cambridge press | IF >5, citations >10 in first year |
| Release (12‑18 mo) | Full Unigine client, quantum integration | 10k MAU, 10 licensed structures |
| Scale (18‑36 mo) | Corporate training, CBDC integration | 100k MAU, 50 B2B clients, $17M revenue/year |

---

## 👥 Contributing & Getting Involved

We welcome collaboration in the spirit of Ersilia’s community. You can contribute in several ways:

- **Code**: Help improve our open‑source components (model wrappers, quantum adapter, documentation). See our [GitHub](https://github.com/qfoldit) (coming soon).
- **Science**: Validate molecular structures, propose new disease targets, or use qFoldIT in your research.
- **Training**: Partner with us to run workshops that combine Ersilia’s AI models with qFoldIT’s gamified interface.
- **Funding**: Support our mission through grants, corporate sponsorship, or licensing partnerships.

For inquiries: **qFoldIT@gmail.com** or reach out via our [website](https://fold.it).

---

## 📄 License & Legal

- **Proprietary components**: Game client, certain visual assets, and the “Stop in Time” mechanic are protected by commercial licenses.
- **Open‑source components**: All scientific libraries and adapters are licensed under GPL‑3.0 or MIT, in line with Ersilia’s policy.
- **Trademarks**: Sankofa and Gye Nyame are registered trademarks of qFoldIT Pte. Ltd. in Singapore (IPOS).
- **Data**: User‑generated structures are shared under CC BY‑NC 4.0 with authorship attribution preserved.

---

## 🙏 Acknowledgements

- **Prof. Kelly Chibale** and **Dr. Godwin Dziwornu** for scientific leadership and the foundational work at H3D.
- **Ersilia Open Source Initiative** for the model hub and shared vision of open science.
- **Centre for Quantum Technologies (CQT)** and the **National Supercomputing Centre (NSCC) Singapore** for providing quantum and HPC resources.
- **National Quantum Strategy (Singapore)** for supporting the development of accessible quantum computing infrastructure.
- **Steam** for distribution and community building.
- The **Ashanti royal lineage** for the symbols Sankofa and Gye Nyame, inspiring our mission to bridge past wisdom with future innovation.

---

**qFoldIT – where every player becomes a co‑inventor.**  
*Sankofa: we retrieve wisdom from the past to build the future.*  
*Gye Nyame: except God, there are no limits.*

[](https://qfoldit.github.io/qFold.html)
![](https://qfoldit.github.io/img/1/qFold.png)
