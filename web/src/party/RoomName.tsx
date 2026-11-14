import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { RoomPlayer } from "@fathom/shared";
import { TapName } from "../components/PlayerCardHost";

/** Everyone in the room by id, so any name on any party screen can be tapped to send a friend request. */
export const RoomPlayersContext = createContext<{ you: string; players: Map<string, RoomPlayer> }>({ you: "", players: new Map() });

/** A party player's name: tap it to send them a friend request (your own name isn't tappable). */
export function RoomName({ id, name, className, style, children }: { id: string; name: string; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const { you, players } = useContext(RoomPlayersContext);
  const p = players.get(id);
  return (
    <TapName name={name} code={p?.code} look={p?.look} you={id === you} className={className} style={style}>
      {children}
    </TapName>
  );
}
