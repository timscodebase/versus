import { $, QwikSubmitEvent, component$, useStore } from "@builder.io/qwik";
import { RequestHandler } from "@builder.io/qwik-city";
import { z } from 'zod'
import { PromptTemplate } from 'langchain/prompts'
import party from 'party-js'
import { Input, Dialog, Svg } from "~/components";
import { jsFormSubmit } from "~/utils";
import allFighters from './fighters.js'

const template = `You're a professional fighting judge from Liverpool and you speak mostly with cockney slang. Who would win in a fight between {opponent1} ("opponent1") and {opponent2} ("opponent2")? Only tell me who the winner is and a short reason why.

Format the response like this:
"winner: opponent1 or opponent2. reason: the reason they won."

Return the winner using only their label ("opponent1" or "opponent2") and not their name.`
const promptTemplate = new PromptTemplate({
  template: template,
  inputVariables: ['opponent1', 'opponent2'],
})

export const onPost: RequestHandler = async (requestEvent) => {
  const OPENAI_API_KEY = requestEvent.env.get('OPENAI_API_KEY')
  const formData = await requestEvent.parseBody()

  const validation = z.object({
    opponent1: z.string().min(1).max(60),
    opponent2: z.string().min(1).max(60),
  }).safeParse(formData)

  if (!validation.success) {
    requestEvent.json(400, {
      errors: validation.error.issues
    })
    return 
  }

  const opponent1 = formData.opponent1
  const opponent2 = formData.opponent2

  const prompt = await promptTemplate.format({
    opponent1: opponent1,
    opponent2: opponent2
  })

  const body = {
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 1,
    stream: true
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    console.log(await response.json())
    requestEvent.send(response.status, response.statusText)
    return
  }

  if (!response.body) {
    requestEvent.send(200, '')
    return
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Do work before streaming
      // @ts-ignore
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let isStillStreaming = true

      while(isStillStreaming) {
        const {value, done} = await reader.read()
        const chunkValue = decoder.decode(value)

        /**
         * Captures any string after the text `data: `
         * @see https://regex101.com/r/R4QgmZ/1
         */
        const regex = /data:\s*(.*)/g
        let match = regex.exec(chunkValue)

        while (match !== null) {
          const payload = match[1]
          
          // Close stream
          if (payload === '[DONE]') {
            controller.close()
          } else {
            const json = JSON.parse(payload)
            const text = json.choices[0].delta.content || ''
  
            // Send chunk of data
            controller.enqueue(text)
          }

          match = regex.exec(chunkValue)
        }

        isStillStreaming = !done
      }
    }
  })

  requestEvent.send(new Response(stream))
}

export default component$(() => {
  const state = useStore({
    isLoading: false,
    text: '',
    winner: '',
    opponent1: '',
    opponent2: '',
  })

  const handleSubmit = $(async (event: QwikSubmitEvent) => {
    state.isLoading = true
    state.text = ''
    state.winner = ''

    const form = event.target as HTMLFormElement

    const response = await jsFormSubmit(form)

    if (!response.ok) {
      state.isLoading = false
      alert("The request experienced an issue.")
      return
    }

    if (!response.body) {
      state.isLoading = false
      return
    }

    // Parse streaming body
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let isStillStreaming = true

    while(isStillStreaming) {
      const {value, done} = await reader.read()
      const chunkValue = decoder.decode(value)
      
      state.text += chunkValue

      isStillStreaming = !done
    }

    const winnerPattern = /winner:\s+(\w+).*/gi
    const match = winnerPattern.exec(state.text)

    state.winner = match?.length ? match[1].toLowerCase() : ''

    if (state.winner) {
      const winnerInput = document.querySelector(`textarea[name=${state.winner}]`)
      if (winnerInput) {
        party.confetti(winnerInput, {
          count: 40,
          size: 2,
          spread: 15
        })
      }
    }
    
    state.isLoading = false
  })

  const imgState = useStore({
    showDialog: false,
    isLoading: false,
    url: ''
  })
  const onSubmitImg = $(async (event: QwikSubmitEvent) => {
    imgState.showDialog = true
    imgState.isLoading = true

    const form = event.target as HTMLFormElement

    const response = await jsFormSubmit(form)
    const results = await response.json()

    imgState.url = results.url
    imgState.isLoading = false
  })

  const pickRandomFighters = $(() => {
    state.text = ''
    state.winner = ''

    const fighters = [...allFighters]
    const index1 = Math.floor(Math.random() * fighters.length)
    const [fighter1] = fighters.splice(index1, 1)
    const index2 = Math.floor(Math.random() * fighters.length)
    const fighter2 = fighters[index2]

    state.opponent1 = fighter1
    state.opponent2 = fighter2
  })

  return (
    <main class="max-w-4xl mx-auto p-4">
      <h1 class="text-4xl">AI of the Tiger</h1>
      <p>An AI bot that will determine who would win in a fight between...</p>

      <form 
        method="post"
        class="grid gap-4 mt-8"
        preventdefault:submit
        onSubmit$={handleSubmit}
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <Input
            label="Opponent 1"
            name="opponent1"
            value={state.opponent1}
            class={{
              rainbow: state.winner === 'opponent1'
            }}
            required
            maxLength="100"
            onInput$={(e) => state.opponent1 = e.target?.value}
          />
          <Input
            label="Opponent 2"
            name="opponent2"
            value={state.opponent2}
            class={{
              rainbow: state.winner === 'opponent2'
            }}
            required
            maxLength="100"
            onInput$={(e) => state.opponent2 = e.target?.value}
          />
        </div>

        <div class="flex gap-4">
          <button type="submit" aria-disabled={state.isLoading}>
            {state.isLoading ? <Svg alt="Loading" icon="icon-spinner" /> : 'Tell me'}
          </button>
          <button type="button" title="Feeling lucky?" onClick$={pickRandomFighters}>
            <Svg alt="Pre-fill random fighter" icon="icon-random" />
          </button>
        </div>
      </form>

      {state.text && (
        <article class="mt-4 border border-2 rounded-lg p-4 bg-[canvas]">
          <p>{state.text.slice(27)}</p>
        </article>
      )}

      {state.winner && (
        <form
          action="/ai-image"
          preventdefault:submit
          onSubmit$={onSubmitImg}
          class="mt-4"
        >
          <input
            type="hidden"
            name="opponent1"
            value={state.opponent1}
            required
          />
          <input
            type="hidden"
            name="opponent2"
            value={state.opponent2}
            required
          />
          <input
            type="hidden"
            name="winner"
            value={state.winner}
            required
          />
          <button type="submit">
            Show me
          </button>
        </form>
      )}

      <Dialog
        toggle={false}
        open={imgState.showDialog}
        onClose$={() => imgState.showDialog = false}
      >
        {imgState.isLoading && (
          <Svg alt="Loading" icon="icon-spinner" class="text-8xl" />
        )}
        {!imgState.isLoading && imgState.url && (
          <img src={imgState.url} alt={`An epic battle between ${state.opponent1} and ${state.opponent2}`} />
        )}
      </Dialog>

      <p class="my-10 sm:mt-20 text-center">Disclaimer: This app uses AI to generate content, so things may come out a lil' wonky sometimes.</p>
    </main>
  );
});
