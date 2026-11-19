// Copy for both / and /orbit.
export const site = {
  title: "Pluto — DevNation's knowledge companion",
  description:
    "Find DevNation updates, upcoming meetings, and project details from the club's shared sources.",
  hero: {
    title: "Meet Pluto. DevNation's knowledge companion.",
    description:
      "Pluto reads the club's Discord, GitHub and Miro so you don't have to dig. Ask it what's happening, when the next meeting is, or what a project is about.",
    note: "It only answers from what the club has actually shared.",
  },
  sources: {
    title: "Where Pluto looks",
    description:
      "Club updates are spread across conversations, code and shared boards. Pluto helps you find them.",
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
      {
        title: "Get a reminder",
        description: "Pluto posts a reminder before a confirmed club meeting.",
      },
    ],
  },
  commands: {
    label: "Commands",
    title: "What Pluto can do",
    introduction:
      "Everything Pluto does starts with a slash command, except meeting reminders, which it handles on its own.",
    groups: [
      {
        group: "Catch up",
        commands: [
          {
            command: "/digest",
            description: "A summary of recent club activity, with counts and links.",
            options: "days (1 to 30, default 7)",
          },
          {
            command: "/upcoming meetings",
            description: "Meetings coming up, picked up from announcements in #meeting-plans.",
          },
          { command: "/upcoming events", description: "Club events that are scheduled." },
        ],
      },
      {
        group: "Events",
        commands: [
          {
            command: "/event add",
            description: "Add a club event. Anyone can add one.",
            options: "title, date (YYYY-MM-DD), time (IST); end and description are optional",
          },
          {
            command: "/event cancel",
            description:
              "Cancel an event by its ID. You can cancel your own, and people with Manage Events can cancel any.",
            options: "event ID",
          },
        ],
      },
      {
        group: "Other",
        commands: [
          { command: "/help", description: "Lists the commands with examples." },
          { command: "/optout", description: "Stops Pluto from indexing your Discord messages." },
        ],
      },
    ],
    reminder:
      "Meeting reminders need no command. When a meeting is announced in #meeting-plans, Pluto posts one reminder in #pluto an hour before it starts.",
  },
  privacy: {
    title: "What Pluto can see",
    description:
      "Pluto reads information the club has chosen to share. It doesn't change projects, boards or old messages.",
    items: [
      {
        title: "Selected channels",
        description: "It doesn't read private channels or voice chats.",
      },
      { title: "Public projects", description: "It doesn't read private GitHub repositories." },
      {
        title: "Your choice",
        description: "Use /optout to remove your messages and leave them out in the future.",
      },
    ],
  },
  about: {
    title: "Made at DevNation",
    description: "Pluto is an open-source project built by students at AJIET for the club.",
  },
} as const;
