import { FlowMap, Turn } from "@/components/quizEditorTypes";

export const mockTurns: Turn[] = [
  {
    id: "turn-1",
    label: "Turn 1",
    questions: [
      {
        id: "q-1",
        type: "multiple-choice",
        body: "What is the capital of France?",
        instruction: "Select one answer.",
        options: [
          { id: "opt-1", text: "Berlin", isCorrect: false },
          { id: "opt-2", text: "Paris", isCorrect: true },
          { id: "opt-3", text: "Rome", isCorrect: false },
          { id: "opt-4", text: "Madrid", isCorrect: false }
        ],
        sampleSolution: "",
        sourceBit: {}
      }
    ]
  },
  {
    id: "turn-2",
    label: "Turn 2",
    questions: [
      {
        id: "q-2",
        type: "true-false-1",
        body: "The Pacific Ocean is the largest ocean on Earth.",
        instruction: "Choose True or False.",
        options: [
          { id: "opt-1", text: "True", isCorrect: true },
          { id: "opt-2", text: "False", isCorrect: false }
        ],
        sampleSolution: "",
        sourceBit: {}
      },
      {
        id: "q-3",
        type: "question-1",
        body: "Define recursion in one sentence.",
        instruction: "Answer briefly.",
        options: [],
        sampleSolution:
          "Recursion is when a function calls itself to solve a smaller instance of the same problem.",
        sourceBit: {}
      }
    ]
  },
  {
    id: "turn-3",
    label: "Turn 3",
    questions: [
      {
        id: "q-4",
        type: "essay",
        body: "Explain the difference between a stack and a queue.",
        instruction: "Write a concise paragraph.",
        options: [],
        sampleSolution:
          "A stack is LIFO while a queue is FIFO; items are removed in reverse vs insertion order respectively.",
        sourceBit: {}
      },
      {
        id: "q-4b",
        type: "sequence",
        body: "Arrange software development lifecycle phases in order.",
        instruction: "Order from first to last.",
        options: [
          { id: "s1", text: "Requirements", isCorrect: true },
          { id: "s2", text: "Design", isCorrect: true },
          { id: "s3", text: "Implementation", isCorrect: true },
          { id: "s4", text: "Testing", isCorrect: true },
          { id: "s5", text: "Deployment", isCorrect: true }
        ],
        sampleSolution: "",
        sourceBit: {}
      }
    ]
  },
  {
    id: "turn-4",
    label: "Turn 4",
    questions: [
      {
        id: "q-5",
        type: "multiple-choice",
        body: "Which data structure uses LIFO order?",
        instruction: "Select one answer.",
        options: [
          { id: "opt-1", text: "Queue", isCorrect: false },
          { id: "opt-2", text: "Stack", isCorrect: true },
          { id: "opt-3", text: "Linked List", isCorrect: false },
          { id: "opt-4", text: "Array", isCorrect: false }
        ],
        sampleSolution: "",
        sourceBit: {}
      }
    ]
  }
];

export const mockFlow: FlowMap = {
  "turn-1": { correct: "turn-2", incorrect: "turn-3" },
  "turn-2": { correct: "turn-4", incorrect: "turn-1" },
  "turn-3": { correct: "turn-4", incorrect: "end" },
  "turn-4": { correct: "end", incorrect: "turn-3" }
};

export const mockBitmarkQuizWrappers = [
  {
    bit: {
      id: "q1",
      type: "multiple-choice",
      format: "text",
      body: "What is the capital of France?",
      instruction: "Select one answer.",
      choices: [
        { choice: "Berlin", isCorrect: false },
        { choice: "Paris", isCorrect: true },
        { choice: "Rome", isCorrect: false },
        { choice: "Madrid", isCorrect: false }
      ],
      extraProperties: {
        quizTools: [
          { tool: "calculator", label: "Calculator", purpose: "Perform calculations" },
          { tool: "scratchpad", label: "Scratchpad", purpose: "Work through the answer" },
          {
            tool: "text-highlighter",
            label: "Highlighter",
            purpose: "Highlight key parts",
            initialData: { text: "What is the capital of France?", keywords: ["capital", "France"] }
          }
        ]
      }
    }
  },
  {
    bit: {
      id: "q2",
      type: "true-false-1",
      format: "text",
      body: "The Pacific Ocean is the largest ocean on Earth.",
      instruction: "Mark True or False.",
      statements: [{ statement: "True", isCorrect: true }],
      extraProperties: {
        quizTools: [
          { tool: "calculator", label: "Calculator", purpose: "Perform calculations" },
          { tool: "scratchpad", label: "Scratchpad", purpose: "Work through the answer" },
          {
            tool: "text-highlighter",
            label: "Highlighter",
            purpose: "Highlight key parts",
            initialData: { text: "The Pacific Ocean is the largest ocean on Earth.", keywords: ["Pacific Ocean", "largest"] }
          }
        ]
      }
    }
  },
  {
    bit: {
      id: "q3",
      type: "question-1",
      format: "text",
      body: "Define recursion in one or two sentences.",
      instruction: "Provide a short answer.",
      sampleSolution: "Recursion is a method where a function solves a problem by calling itself on smaller inputs.",
      extraProperties: {
        quizTools: [
          { tool: "calculator", label: "Calculator", purpose: "Perform calculations" },
          { tool: "scratchpad", label: "Scratchpad", purpose: "Work through the answer" },
          {
            tool: "text-highlighter",
            label: "Highlighter",
            purpose: "Highlight key parts",
            initialData: { text: "Define recursion in one or two sentences.", keywords: ["recursion"] }
          }
        ]
      }
    }
  },
  {
    bit: {
      id: "q4",
      type: "essay",
      format: "text",
      body: "Explain the difference between a stack and a queue.",
      instruction: "Write a concise paragraph.",
      sampleSolution: "A stack is LIFO while a queue is FIFO; items are removed in reverse vs insertion order respectively.",
      extraProperties: {
        quizTools: [
          { tool: "calculator", label: "Calculator", purpose: "Perform calculations" },
          { tool: "scratchpad", label: "Scratchpad", purpose: "Work through the answer" },
          {
            tool: "text-highlighter",
            label: "Highlighter",
            purpose: "Highlight key parts",
            initialData: { text: "Explain the difference between a stack and a queue.", keywords: ["stack", "queue"] }
          }
        ]
      }
    }
  },
  {
    bit: {
      id: "q5",
      type: "sequence",
      format: "text",
      body: "Arrange the software development lifecycle phases in order.",
      instruction: "Order the responses from first to last.",
      responses: [
        { response: "Requirements", isCorrect: true },
        { response: "Design", isCorrect: true },
        { response: "Implementation", isCorrect: true },
        { response: "Testing", isCorrect: true },
        { response: "Deployment", isCorrect: true }
      ],
      extraProperties: {
        quizTools: [
          { tool: "calculator", label: "Calculator", purpose: "Perform calculations" },
          { tool: "scratchpad", label: "Scratchpad", purpose: "Work through the answer" },
          {
            tool: "text-highlighter",
            label: "Highlighter",
            purpose: "Highlight key parts",
            initialData: {
              text: "Arrange the software development lifecycle phases in order.",
              keywords: ["lifecycle", "order"]
            }
          }
        ]
      }
    }
  }
] as const;
