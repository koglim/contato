# ContatoCerto Design System — Foundation v1

**Status:** DEFINITIVO PARA WP7.0  
**Escopo:** Painel do Profissional / aplicações web futuras do ContatoCerto.  
**Branch de Referência:** `main`

---

## 1. Princípio Central

O painel atual **não é referência visual**.

**Podem ser preservados:**
- Regras de negócio;
- Contratos de API;
- Autenticação e sessões (cookies / OTP / pepper);
- Rotas quando fizer sentido funcional;
- Dados e comportamentos operacionais do BFF.

**Não serão reaproveitados como referência:**
- Componentes visuais legados;
- CSS atual (`globals.css` monolítico antigo);
- Cards, inputs, botões e controles ad-hoc;
- Shell antigo;
- Espaçamentos e paddings arbitrários;
- Hierarquia e composição visual das páginas antigas.

> [!IMPORTANT]
> **Regra Arquitetural Inegociável:**  
> **Telas não definem design. Telas compõem o Design System.**  
> Nenhuma página poderá inventar cor, spacing, radius, botão, input, card ou padrão próprio quando houver equivalente no sistema.

---

## 2. Direção Visual

### Personalidade da Interface
- **Profissional** e **confiável**;
- **Clara**, **moderna** e **funcional**;
- **Humana** e **madura**;
- **Sem aparência de template genérico**.

### Diretrizes Negativas (O que evitar estritamente)
- Gradientes roxo/azul gratuitos;
- Efeitos de glow ou neon;
- Glassmorphism e blur desnecessário;
- Blobs decorativos e ilustrações vazias;
- Cards excessivamente arredondados;
- Sombras pesadas e difusas;
- Excesso de badges/pills decorativas;
- Ícones "mágicos" ou com glitter;
- Estética típica de "AI SaaS";
- Dashboard cheio de caixas ou cards apenas para preencher espaço em branco.

### Hierarquia Visual
A hierarquia deve derivar prioritariamente de:
1. **Tipografia** (tamanho, peso e line-height consistentes);
2. **Espaço** (respiro calculado e ritmo vertical/horizontal);
3. **Alinhamento** e estrutura geométrica;
4. **Contraste** legível;
5. **Cor semântica** intencional;
6. **Elevação** somente quando estritamente necessária.

---

## 3. Arquitetura de Tokens

Os tokens são estruturados em 3 níveis estritos:

$$\text{Primitive} \longrightarrow \text{Semantic} \longrightarrow \text{Component}$$

**Exemplo prático:**  
`blue.600` (`#0B63F6`) $\rightarrow$ `action.primary` $\rightarrow$ `button.primary.background`

> [!WARNING]
> Componentes e páginas de aplicação são **proibidos de consumir valores HEX diretamente**. Todo estilo consome tokens semânticos ou de componente via variáveis CSS (`var(--...)`).

---

## 4. Paleta Primária

### Marca & Ações
- **Primary:** `#0B63F6`
- **Primary Dark:** `#084CC1`
- **Primary Light:** `#EAF2FF`

### Acento
- **Accent:** `#FFB703`
- **Accent Dark:** `#D99000`
- **Accent Light:** `#FFF4CC`

### Status & Feedback
- **Success:** `#0E7C66`
- **Success Light:** `#E8F7F3`
- **Danger:** `#D92D20`
- **Danger Light:** `#FEECEB`

### Superfícies e Tipografia Base (Light)
- **Text Primary:** `#101828`
- **Text Secondary:** `#667085`
- **Text Muted:** `#98A2B3`
- **Border:** `#E4E7EC`
- **Background:** `#F7F8FA`
- **Surface:** `#FFFFFF`

---

## 5. Escala Neutra

| Token | Hex | Uso Típico |
|---|---|---|
| `neutral.50` | `#F9FAFB` | Canvas / backgrounds sutis |
| `neutral.100` | `#F2F4F7` | Superfícies desabilitadas / hover sutil |
| `neutral.200` | `#E4E7EC` | Bordas padrão |
| `neutral.300` | `#D0D5DD` | Bordas destacadas / divisores fortes |
| `neutral.400` | `#98A2B3` | Textos desabilitados / ícones mudos |
| `neutral.500` | `#667085` | Textos secundários / labels |
| `neutral.600` | `#475467` | Textos de apoio escuros |
| `neutral.700` | `#344054` | Headings secundários / elementos chave |
| `neutral.800` | `#1D2939` | Títulos e elementos de alto contraste |
| `neutral.900` | `#101828` | Texto primário (Light) |
| `neutral.950` | `#0C111D` | Canvas base (Dark Mode) |

---

## 6. Tokens Semânticos — Modo Claro (Light)

### Backgrounds
- `bg.canvas` $\rightarrow$ `#F7F8FA`
- `bg.surface` $\rightarrow$ `#FFFFFF`
- `bg.subtle` $\rightarrow$ `#F9FAFB`
- `bg.elevated` $\rightarrow$ `#FFFFFF`

### Textos
- `text.primary` $\rightarrow$ `#101828`
- `text.secondary` $\rightarrow$ `#667085`
- `text.muted` $\rightarrow$ `#98A2B3`
- `text.inverse` $\rightarrow$ `#FFFFFF`

### Bordas
- `border.subtle` $\rightarrow$ `#EAECF0`
- `border.default` $\rightarrow$ `#E4E7EC`
- `border.strong` $\rightarrow$ `#D0D5DD`

### Ações
- `action.primary` $\rightarrow$ `#0B63F6`
- `action.primary.hover` $\rightarrow$ `#084CC1`
- `action.primary.subtle` $\rightarrow$ `#EAF2FF`

### Acento & Status
- `accent.default` $\rightarrow$ `#FFB703`
- `accent.strong` $\rightarrow$ `#D99000`
- `accent.subtle` $\rightarrow$ `#FFF4CC`
- `success.default` $\rightarrow$ `#0E7C66`
- `success.subtle` $\rightarrow$ `#E8F7F3`
- `danger.default` $\rightarrow$ `#D92D20`
- `danger.subtle` $\rightarrow$ `#FEECEB`

> [!NOTE]
> `Warning` deve ser tratado como token semântico autônomo, separado de `Accent`, mesmo quando pertencer à mesma família cromática amarela/laranja.

---

## 7. Modo Escuro (Dark Mode)

- O Dark Mode nasce nativo e sincronizado com o sistema.
- **Não será inversão cromática automática.**
- Suporte a seleção de tema:
  - **Light**
  - **Dark**
  - **System** (acompanha `prefers-color-scheme`)
- Implementação técnica:
  - CSS Custom Properties com chaveamento via atributo `data-theme` no `<html>`;
  - Controlador de tema first-party (sem dependência de `next-themes` nesta fase);
  - Persistência em `localStorage` com script inline para prevenção de FOUC (flash of unstyled content).

### Mapeamento Base Dark
- `bg.canvas` $\rightarrow$ `#0C111D`
- `bg.surface` $\rightarrow$ `#101828`
- `bg.subtle` $\rightarrow$ `#1D2939`
- `bg.elevated` $\rightarrow$ `#182230`
- `text.primary` $\rightarrow$ `#F9FAFB`
- `text.secondary` $\rightarrow$ `#D0D5DD`
- `text.muted` $\rightarrow$ `#98A2B3`
- `border.default` $\rightarrow$ `#344054`
- `border.strong` $\rightarrow$ `#475467`
- Links e ações textuais em dark $\rightarrow$ `#5B96FF`
- Botão primário no Dark Mode mantém contraste acessível com texto branco.

---

## 8. Tipografia

- **Fonte Oficial:** **Inter** (`next/font/google`).
- **Fallback:** `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.
- **Pesos Permitidos:**
  - `400` Regular
  - `500` Medium
  - `600` SemiBold
  - `700` Bold *(apenas títulos excepcionais)*
- **Default Operacional:** `body-md` = 14px / line-height 20px / 400.
- Valores numéricos, contadores e tabelas devem ativar suporte a numerais tabulares (`font-variant-numeric: tabular-nums`).

### Escala Tipográfica
| Token | Tamanho (px) | Line-height (px) | Peso |
|---|---:|---:|---:|
| `display-lg` | 36 | 44 | 600 |
| `heading-xl` | 30 | 38 | 600 |
| `heading-lg` | 24 | 32 | 600 |
| `heading-md` | 20 | 28 | 600 |
| `heading-sm` | 18 | 26 | 600 |
| `body-lg` | 16 | 24 | 400 |
| `body-md` | 14 | 20 | 400 |
| `body-sm` | 13 | 18 | 400 |
| `label-lg` | 14 | 20 | 500 |
| `label-md` | 13 | 18 | 500 |
| `caption` | 12 | 16 | 400 / 500 |

---

## 9. Espaçamento (Spacing)

- **Unidade Atômica:** 4px.
- **Ritmo Principal:** 8px.
- **Valores Permitidos:** `0` (0px), `0.5` (2px), `1` (4px), `1.5` (6px), `2` (8px), `3` (12px), `4` (16px), `5` (20px), `6` (24px), `8` (32px), `10` (40px), `12` (48px), `16` (64px), `20` (80px).
- **Faixa de Ouro:** A imensa maioria dos layouts opera nos passos `8 / 12 / 16 / 24 / 32 / 48px`.
- **Regra de Isolamento:** Componentes individuais **não definem margem externa (`margin`)**. O container pai gerencia a distância através de `gap`.

---

## 10. Primitivas de Layout

As primitivas universais substituem CSS ad-hoc:
- `<Box>`
- `<Stack>` (Flex vertical)
- `<Inline>` (Flex horizontal com wrap configurável)
- `<Grid>` (CSS Grid composicional)
- `<Container>` (Restrição de largura e centralização)
- `<Spacer>` (Apenas quando semanticamente justificável)

---

## 11. Grid Responsivo & Breakpoints

- **Mobile:** 4 colunas
- **Tablet:** 8 colunas
- **Desktop:** 12 colunas

### Breakpoints
- `sm` $\rightarrow$ 640px
- `md` $\rightarrow$ 768px
- `lg` $\rightarrow$ 1024px
- `xl` $\rightarrow$ 1280px
- `2xl` $\rightarrow$ 1536px

---

## 12. Calhas da Página (Page Gutters)

- **Mobile:** 16px
- **Tablet:** 24px
- **Desktop:** 32px
- Token de referência: `layout.page-padding`

---

## 13. Larguras de Conteúdo (Content Widths)

- `narrow` (720px): formulários focados, configurações de conta, onboarding.
- `standard` (1040px): maioria das páginas padrão do painel.
- `wide` (1280px): visão geral do dashboard, listagens em grid.
- `full` (100%): tabelas densas, visualizadores e logs que exigem toda a área útil.

---

## 14. Geometria & Cantos (Radius)

- `radius.0` = 0px
- `radius.1` = 4px
- `radius.2` = 6px
- `radius.3` = 8px $\rightarrow$ **Buttons, Inputs, Selects, Textareas**
- `radius.4` = 10px $\rightarrow$ **Popovers, Dropdowns**
- `radius.5` = 12px $\rightarrow$ **Cards padrão**
- `radius.6` = 16px $\rightarrow$ **Dialogs, Sheets**
- `radius.full` = 999px $\rightarrow$ **Avatares, Badges/Pills funcionais**

---

## 15. Bordas & Elevação (Shadows)

- Borda padrão: 1px em `border.default`.
- Focus ring: indicador de foco de 2px separado e visível (`focus-visible`).
- Divisor padrão: 1px em `border.subtle`.
- Filosofia de elevação: **superfície + borda antes de sombra**.
- Sombras neutras e sem glow:
  - `shadow.none`
  - `shadow.xs` (controles flutuantes discretos)
  - `shadow.sm` (dropdowns / popovers)
  - `shadow.md` (dialogs / menus modais)
  - `shadow.lg` (sheets laterais / drawers elevados)

---

## 16. Movimento & Transições (Motion)

- Duração:
  - `duration.instant` = 0ms
  - `duration.fast` = 100ms (hovers)
  - `duration.normal` = 160ms (tooltips e dropdowns)
  - `duration.medium` = 220ms (dialogs)
  - `duration.slow` = 320ms (drawers e sheets)
- Easings:
  - Standard: `cubic-bezier(0.2, 0, 0, 1)`
  - Enter: `cubic-bezier(0, 0, 0, 1)`
  - Exit: `cubic-bezier(0.4, 0, 1, 1)`
- Suporte estrito a `prefers-reduced-motion: reduce`.

---

## 17. Iconografia

- Biblioteca oficial exclusiva: **Lucide React**.
- Tamanhos padrão: 16px, 18px, **20px (default operacional)**, 24px.
- Stroke: 1.75px a 2px.
- Botões exclusivamente com ícone exigem `aria-label` obrigatório.
- Ícones decorativos recebem `aria-hidden="true"`.

---

## 18. Catálogo de Componentes Essenciais

O escopo do WP7.0 abrange a implementação limpa dos componentes:

1. **Ações:** `Button`, `IconButton`.
2. **Formulários:** `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`.
3. **Superfícies:** `Card`, `Avatar`, `Badge`.
4. **Feedback:** `Alert`, `InlineMessage`, `Toast`, `Progress`, `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`.
5. **Overlays:** `Dialog`, `AlertDialog`, `Sheet`, `Popover`, `DropdownMenu`, `Tooltip`.
6. **Navegação & Dados:** `Tabs`, `Table`, `Pagination`, `PageHeader`, `PageSection`, `AppShell`.

---

## 19. Acessibilidade (WCAG 2.2 AA)

- Contraste de texto normal $\ge 4.5:1$.
- Alvo de toque/clique operacional preferido $\ge 40\text{px}$ (mínimo absoluto WCAG de 24px).
- Teclado total (navegação via Tab, acionamento por Enter/Space, fechamento por Escape).
- Gerenciamento de foco estrito em modais e sheets.
- HTML nativo em primeiro lugar; semântica e landmarks completos.

---

## 20. Escolhas Técnicas & Pilha Web

- **Framework:** Next.js 16 (App Router), React 19, TypeScript.
- **Estilização:** CSS Custom Properties + CSS Modules (zero CSS-in-JS).
- **Primitivas de Acessibilidade:** Radix UI Primitives (`@radix-ui/*`).
- **Iconografia:** `lucide-react`.
- **Tipografia:** `next/font` (Inter).
- **Catálogo de Componentes:** Storybook (`@storybook/nextjs-vite` ou equivalente com addon a11y).
- **Proibições:** Sem Tailwind, sem shadcn/ui gerado, sem frameworks CSS pesados.

---

## 21. Estrutura de Arquivos Planejada

```text
apps/web/design-system/
├── tokens/
│   ├── primitives.css
│   ├── semantic.css
│   ├── themes.css
│   ├── spacing.css
│   ├── typography.css
│   └── motion.css
├── foundation/
│   ├── reset.css
│   └── base.css
├── layout/
│   ├── Box/
│   ├── Stack/
│   ├── Inline/
│   ├── Grid/
│   └── Container/
├── components/
│   ├── Button/
│   ├── IconButton/
│   ├── Input/
│   ├── Textarea/
│   ├── Select/
│   ├── Checkbox/
│   ├── Radio/
│   ├── Switch/
│   ├── Card/
│   ├── Avatar/
│   ├── Badge/
│   ├── Alert/
│   ├── Toast/
│   ├── Tooltip/
│   ├── DropdownMenu/
│   ├── Tabs/
│   ├── Dialog/
│   ├── Sheet/
│   ├── Skeleton/
│   ├── EmptyState/
│   ├── Spinner/
│   ├── Table/
│   └── Pagination/
├── shell/
│   ├── AppShell/
│   ├── Sidebar/
│   ├── Header/
│   ├── PageShell/
│   ├── PageHeader/
│   └── PageSection/
├── icons/
├── theme/
└── index.ts
```

---

## 22. Critério de Pronto (DoD) — WP7.0

O pacote de trabalho WP7.0 estará concluído quando:
- Todos os tokens de cor, tipografia, espaçamento e elevação estiverem codificados e funcionais;
- Alternância Light / Dark / System estiver operando perfeitamente sem FOUC;
- Primitivas de layout (`Box`, `Stack`, `Inline`, `Grid`, `Container`) implementadas;
- Componentes fundamentais listados construídos e documentados em Stories;
- Shell de aplicação responsivo (Desktop, Tablet, Mobile) pronto para receber telas;
- Verificações de acessibilidade (a11y) verdes;
- Lint, Typecheck, Build e Testes do monorepo 100% verdes.

> [!NOTE]
> As telas de negócio existentes (`/dashboard`, `/dashboard/services`, etc.) **não serão migradas dentro do WP7.0**. A migração e substituição das páginas existentes ocorrerá nos checkpoints subsequentes (WP7.1+).
