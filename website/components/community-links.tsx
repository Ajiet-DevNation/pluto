// Set at build time once the community's official invite is supplied.
const invite = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;
const discordInvite = invite && /^https:\/\/(discord\.gg\/|discord\.com\/invite\/)[\w-]+\/?$/.test(invite) ? invite : null;

export function CommunityLinks() {
  return (
    <div className="button-row">
      {discordInvite && <a className="pill-button" href={discordInvite}>Join DevNation <span aria-hidden="true">↗</span></a>}
      <a className={`pill-button ${discordInvite ? "ghost" : ""}`} href="https://github.com/Ajiet-DevNation/pluto">Explore on GitHub <span aria-hidden="true">↗</span></a>
    </div>
  );
}
