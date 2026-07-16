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
        style={{ background: "#FBBF24", clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
      />
      {/* mast */}
      <div className="absolute left-[71px] top-[6px] h-[96px] w-[3px] rounded" style={{ background: "#93A896" }} />
      {/* mainsail (lime, right of mast) */}
      <div
        className="absolute left-[74px] top-[16px] h-[86px] w-[46px]"
        style={{ background: "#A3E635", clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
      />
      {/* jib (dark green, left of mast) */}
      <div
        className="absolute left-[30px] top-[34px] h-[68px] w-[38px]"
        style={{ background: "#365B2B", clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
      />
      {/* hull */}
      <div
        className="absolute left-[16px] top-[102px] h-[30px] w-[118px]"
        style={{
          background: "#365B2B",
          border: "3px solid #A3E635",
          borderRadius: "6px 6px 26px 26px",
        }}
      />
      {/* water */}
      <div
        className="absolute left-[10px] top-[140px] h-[12px] w-[130px] rounded-[50%]"
        style={{ background: "rgba(163,230,53,.10)" }}
      />
    </div>
  )
}
