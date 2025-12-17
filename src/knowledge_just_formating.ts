// src/knowledge.ts

export const STRATEGY_CONTEXT = `
DOCUMENT 1: ANALYSIS OF AI STRATEGIES OF OTHER NATIONS

## DISTILLED DATA: GLOBAL AI ECOSYSTEM AND INNOVATION

### Global Measurement and Ranking Metrics

AI capacity is typically measured using multi-dimensional indices, such as the Global AI Index (GAII). This measurement system focuses on six core pillars: **Talent, Infrastructure, Operating Environment, Research, Development, and Commercial/Investment**.

| Category | Key Metrics/Indicators (Examples) |
| :--- | :--- |
| **Research & Development** | Volume and citation count of scholarly publications (e.g., China leads in total volume, the US leads in highly cited papers). Patents filed/granted. Number of notable AI models released. |
| **Talent** | AI talent concentration (relative to population, e.g., on LinkedIn). Net AI skills migration flows. University AI program enrollment. |
| **Investment** | Venture Capital (VC) funding and Minority stake/M&A deals (e.g., total global corporate investment was $360.73 billion from 2013–2024). Government R&D spending/contracts. |
| **Infrastructure** | Access to computing resources/GPUs (e.g., usage cited in research papers). Broadband connectivity/5G deployment. Data management and governance frameworks. |
| **Technical Performance** | AI model performance assessed against standardized benchmarks (e.g., MMLU, MATH, GPQA). Cost of model training and inference. |


DOCUMENT 2: ENHANCED PROPOSAL FOR UKRAINE’S AI ECOSYSTEM
This proposal outlines a National AI Strategy for Ukraine: "Resilience, Defense, and Reconstruction."

It draws directly from the provided distilled data, adapting the strategies of successful nations (Israel’s defense focus, India’s digital public infrastructure, the EU’s regulatory framework, and Japan’s agile governance) to fit Ukraine’s unique context of war, recovery, and EU integration.

National AI Strategy Proposal: Ukraine 2025–2030
Vision: "The Digital Fortress of Europe"
To utilize Artificial Intelligence as the primary asymmetrical advantage in national defense, the accelerator of post-war reconstruction, and the engine for integrating Ukraine’s IT sector into the high-value global value chain.

I. Strategic Context: Capitalizing on Global Trends
Based on the distilled global landscape, Ukraine faces specific opportunities and constraints:

The Opportunity: While the US and China dominate Foundational Model training (requiring billions in investment), the cost of inference (applying AI) has dropped 280-fold. This allows Ukraine to focus on the Application Layer rather than the Infrastructure Layer.
The Constraint: Global high-quality public data will be exhausted by 2026–2032. Ukraine must urgently organize its unique sovereign data (war, agriculture, energy grid resilience) to train specialized models.
The Productivity Lever: With a smaller workforce due to migration and war, Ukraine must leverage the 10–45% productivity gains observed in high-skilled sectors to rebuild with fewer hands.
II. The 5 Strategic Pillars
Pillar 1: "Mil-Tech" & Dual-Use Innovation (The Israel Model)
Inspiration: Israel's focus on AI-HPC and localized advantage.

Objective: Establish Ukraine as the global testing ground and leader in defense AI and autonomous systems.
Action Plan:
Asymmetric Warfare Lab: Direct R&D funding toward low-cost, high-volume autonomous systems (drones) and signal processing, leveraging the "Talent" metric where Ukraine is strong.
The "Iron Data" Doctrine: Treat battlefield data as a strategic asset. Create secure pipelines to feed real-time data into inference models for decision support, similar to how the US uses industry-led models.
Dual-Use Incubators: Create a simplified procurement pathway for startups to sell to the Ministry of Defense, ensuring IP can be commercialized globally later (mirroring the US "Private Investment" lead).
Pillar 2: Sovereign Data & "AI for Reconstruction" (The India Model)
Inspiration: India’s "India Dataset Platform" (IDP) and "AI for All."

Objective: Overcome the looming global "Data Scarcity" by capitalizing on Ukraine’s unique, non-public datasets.
Action Plan:
National Data Lake for Reconstruction: Aggregate anonymized data from construction, energy, and agriculture. Offer access to global partners (Microsoft, Google, Palantir) in exchange for compute credits, overcoming the high capital barrier of infrastructure.
Ukrainian LLM (U-LLM): Following India’s push for indigenous models and Israel’s Hebrew NLP focus, Ukraine must fund the fine-tuning of open-source models (like Llama) on Ukrainian language corpora to preserve cultural sovereignty and counter disinformation.
Sector-Specific AI: Deploy AI in agriculture (precision farming to clear mined lands) and energy (grid balancing), areas where Ukraine has high-quality proprietary data.
Pillar 3: Government as a Platform & Productivity (The Canada/Estonia Model)
Inspiration: Canada’s "Directive on Automated Decision-Making" and public sector productivity focus.

Objective: Use AI to mitigate the labor shortage caused by the war and migration.
Action Plan:
AI-First Civil Service: Integrate AI agents into the "Diia" ecosystem. Goal: Automate 50% of bureaucratic processes to free up human capital for high-complexity tasks (leveraging the 10–45% productivity gain statistic).
Reskilling for Recovery: Since AI helps "narrow the gap between low- and high-skilled workers," launch a national upskilling program targeting veterans and displaced persons to enter the digital workforce.
Pillar 4: Agile Governance & EU Alignment (The Japan/EU Hybrid)
Inspiration: Japan’s "Agile Governance" vs. EU’s "AI Act."


DOCUMENT 3: PRACTICAL STEPS AND IMPLEMENTATION
This document serves as the operational roadmap for the National AI Strategy: "The Digital Fortress of Europe." It translates strategic pillars into executable directives, assigning ownership, timelines, and resource mechanisms.

ACTION PLAN: IMPLEMENTATION OF UKRAINE’S NATIONAL AI STRATEGY (2025–2027)

`;

export const SYSTEM_INSTRUCTIONS = `
You are a specialized assistant for Ukraine’s AI ecosystem development strategy.
Your strictly limited knowledge base is the provided context above.

RULES:
1. You must answer questions ONLY based on the provided context.
2. If the user's request is not clearly related to Ukraine’s AI strategy, DefenseTech funding, or the specific programs mentioned, you must refuse.
3. Standard refusal message: "I can only answer questions related to Ukraine’s AI ecosystem development strategy and its implementation."
4. Do not hallucinate. If the answer is not in the text, say "This specific information is not covered in the strategy documents."

FORMATTING RULES (CRITICAL – SLACK ONLY)
You are generating messages for Slack. Slack formatting is NOT Markdown. You must follow Slack syntax exactly.

Allowed formatting:
Bold: use single asterisks only
Correct: bold text
Incorrect: bold, bold

Lists: use "-" or "•" only
Do not use numbered lists unless explicitly requested.

Links: use Slack link syntax only
Format: <URL|Link Text>
Do NOT use Markdown links.

Inline code: use single backticks only
Do NOT use triple backticks or fenced code blocks.

Disallowed formatting (STRICT):
Do NOT use double asterisks (**)
Do NOT use underscores for emphasis
Do NOT use Markdown headers (#, ##, ###)
Do NOT use blockquotes (>)
Do NOT use triple backticks
Do NOT use tables

Output requirements:
Output must be valid Slack message text.
If any Markdown syntax appears, the response is invalid and must be regenerated.
`;