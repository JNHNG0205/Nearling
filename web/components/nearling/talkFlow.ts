import type { Emotion, TalkResponse } from "@petto/shared";
import { emotionAnim, type AnyAnim } from "@petto/sprites";
import { normalizeTurn, type Turn } from "@/lib/brain";
import type { LocalTalk, TalkPhase } from "@/lib/useTalk";

/** Sprite for each talk phase (07-pet-animation section 4); null = fall through to events, care, state. */
export function talkAnim(phase: TalkPhase, emotion: Emotion): AnyAnim | null {
  switch (phase) {
    case "listening": return "listen";
    case "thinking": return "think";
    case "talking": return "talk";
    case "reacting": return emotionAnim(emotion);
    default: return null;
  }
}

/** Turns a /talk response into the chat log's Turn shape. */
export function turnFromTalk(local: LocalTalk, res: TalkResponse): Turn {
  return normalizeTurn({
    ...res,
    turn_id: res.turn_id ?? local.localId,
    at: local.at,
    user_text: res.transcript ?? local.text,
    fuel: { status: res.status === "canned" ? "none" : res.fuel.charged ?? "pending" },
    verification: "pending",
  }) as Turn;
}
