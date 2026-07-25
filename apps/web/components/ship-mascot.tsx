/**
 * Pure-CSS ship mascot (~150×160), bobbing 3s. No raster assets by design:
 * grey mast, lime mainsail + dark-green jib via clip-path triangles,
 * mascot-green hull with a lime border and rounded bottom, gold pennant,
 * faint lime ellipse for water.
 */
export function ShipMascot() {
  return (
    <div className="animate-bob relative h-[160px] w-[150px] shrink-0" aria-hidden>
      {/* pennant */}
      <div
        className="absolute left-[72px] top-[6px] h-3 w-5"
        style={{ background: "#f2c94c", clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
      />
      {/* mast */}
      <div className="absolute left-[71px] top-[6px] h-[96px] w-[3px] rounded" style={{ background: "#9aa9c6" }} />
      {/* mainsail (lime, right of mast) */}
      <div
        className="absolute left-[74px] top-[16px] h-[86px] w-[46px]"
        style={{ background: "#c6ff3d", clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
      />
      {/* jib (dark green, left of mast) */}
      <div
        className="absolute left-[30px] top-[34px] h-[68px] w-[38px]"
        style={{ background: "#2f4d7a", clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      />
      {/* hull */}
      <div
        className="absolute left-[16px] top-[102px] h-[30px] w-[118px]"
        style={{
          background: "#2f4d7a",
          border: "3px solid #c6ff3d",
          borderRadius: "6px 6px 26px 26px",
        }}
      />
      {/* water */}
      <div
        className="absolute left-[10px] top-[140px] h-[12px] w-[130px] rounded-[50%]"
        style={{ background: "rgba(198,255,61,.10)" }}
      />
    </div>
  )
}
