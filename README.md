# ⚡ Logic Lab

A local, dependency-free digital logic simulator for learning and experimenting with
gates, latches, flip-flops, registers and counters — inspired by Crocodile Clips and
TIA Portal function blocks.

## Run it

Just double-click **index.html** — no server, no install. Everything is plain
HTML/CSS/JavaScript.

## Highlights

- **Drag & drop** gates (NOT, AND, OR, NAND, NOR, XOR, XNOR, BUF), inputs, outputs,
  a clock and constants onto the worksheet; drag pin-to-pin to wire.
- **Resizable gates** — select a gate and use the **− / +** buttons to set 2–8 input pins.
- **Everything is gates**: the built-in SR latch, D latch, D/JK/T flip-flops, 4-bit
  register, shift register and ripple counter are all built hierarchically out of
  logic gates. **Double-click any chip to look inside** — also live during simulation —
  and use the breadcrumb bar to go back.
- **Custom ICs**: build a circuit with Inputs/Outputs as the pins and press
  **📦 Create IC**. Your chip appears in the palette and can be used inside bigger
  chips (e.g. build a flip-flop from gates, then a register from your flip-flops).
- **Simulation mode**: toggle inputs by clicking, run/pause the clock, step it
  manually (Next ⏭), step **back in time** (⏮ Prev), and slow the clock down with the
  frequency slider to watch signals ripple through.
- **Inputs ▾ menu** controls all top-level inputs — even while you're inside a chip.
- **Truth table ▾** enumerates up to 8 worksheet inputs; **Boolean ▾** derives the
  boolean formula for every output. Click the little **ƒ** boxes at gate outputs for
  the formula of that exact signal.
- **💾 Save** keeps the sketch + components in browser localStorage (auto-loaded on
  start); **Export/Import** moves custom components around as JSON files.

Press the **?** button in the app for the full how-to.
