// Copy for both / and /orbit. The command replies below are examples, not live data.
export const site = {
  title: "Pluto — DevNation's knowledge companion",
  description: "Find DevNation updates, upcoming meetings, and project details from the club's shared sources.",
  hero: {
    title: "Meet Pluto. DevNation's knowledge companion.",
    description: "Pluto reads the club's Discord, GitHub and Miro so you don't have to dig. Ask it what's happening, when the next meeting is, or what a project is about.",
    note: "It only answers from what the club has actually shared.",
  },
  sources: {
    title: "Where Pluto looks",
    description: "Club updates are spread across conversations, code and shared boards. Pluto helps you find them.",
    items: [
      { title: "Discord", description: "Updates from the club's selected channels." },
      { title: "GitHub", description: "Public projects and the work behind them." },
      { title: "Miro", description: "Shared boards, when the club connects them." },
    ],
  },
  everyday: {
    title: "See what's going on",
    description: "Get a quick picture of club activity, or check what's coming up.",
    items: [
      { title: "Catch up", description: "See recent activity with /digest." },
      { title: "Plan ahead", description: "Check meetings and events with /upcoming." },
      { title: "Get a reminder", description: "Pluto posts a reminder before a confirmed club meeting." },
    ],
  },
  preview: {
    title: "Ask Pluto a question.",
    greeting: "Hi, I'm Pluto. Try one of these.",
    disclaimer: "This is a preview. It doesn't connect to Discord or change anything.",
  },
  privacy: {
    title: "What Pluto can see",
    description: "Pluto reads information the club has chosen to share. It doesn't change projects, boards or old messages.",
    items: [
      { title: "Selected channels", description: "It doesn't read private channels or voice chats." },
      { title: "Public projects", description: "It doesn't read private GitHub repositories." },
      { title: "Your choice", description: "Use /optout to remove your messages and leave them out in the future." },
    ],
  },
  about: {
    title: "Made at DevNation",
    description: "Pluto is an open-source project built by students at AJIET for the club.",
  },
} as const;

export const commandExamples = [
  { label: "/digest", question: "/digest days:14", answer: "In the last 14 days: 3 new GitHub issues, 12 club messages and 2 decisions. One meeting and one event are coming up." },
  { label: "/upcoming meetings", question: "/upcoming meetings", answer: "Next club sync: Friday at 6:00 PM IST." },
  { label: "/upcoming events", question: "/upcoming events", answer: "Next workshop: Sunday at 10:00 AM IST." },
  { label: "/event add", question: "/event add title:Workshop date:YYYY-MM-DD time:10:00 AM end:5:00 PM", answer: "Workshop added for Sunday at 10:00 AM IST." },
  { label: "/event cancel", question: "/event cancel id:42", answer: "Workshop cancelled. A notice was posted in #events." },
  { label: "/optout", question: "/optout", answer: "Your messages will be left out from now on. Anything already saved will be removed." },
] as const;
