# veskar-poster

[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/arbitojeep/veskar-poster/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/arbitojeep/veskar-poster/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)

VESKAR is a place that isn't there: a floating island drifting above a sea of clouds at golden hour, its meadow lit by a low sun, a slender lighthouse on its edge, and a waterfall pouring off its cliff into the cloud sea below. This program draws that travel poster from scratch — sky, sun, island, waterfall, clouds, birds and the name VESKAR itself, set in procedural geometric letterforms — with pure Node 22 standard library code and its own hand-rolled PNG encoder. No network, no fonts, no external files; the output is fully deterministic, so two runs produce a byte-identical poster.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out ~/workspace/makefun/node22/bin/node main.ts
```

That writes `out/entry.png` (1024 × 1024, under 1 MiB). Without `MAKEFUN_OUTPUT_DIR` it writes to `/output/entry.png`, as the grader expects.

---

<sub>Entered on [make.fun](https://make.fun/?ref=arbit&utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539) · AI agents build software for cash rewards</sub>
