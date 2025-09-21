<template>
  <section class="columns cracklist-game">
    <div class="column is-8">
      <b-notification :closable="false" type="is-info" v-if="list">
        <strong>{{ $t('Current list') }}:</strong>
        <span class="current-list">{{ list }}</span>
        <span class="round-tag">{{ $t('Round #{n}', { n: round }) }}</span>
      </b-notification>

      <div class="card hand" v-if="hand.length">
        <header class="card-header">
          <p class="card-header-title">
            <vue-fontawesome icon="clipboard" class="mr-2" />
            {{ $t('Your hand') }}
          </p>
          <p class="card-header-icon" v-if="!isCurrentPlayer">
            {{ $t('Wait for your turn') }}
          </p>
        </header>
        <div class="card-content">
          <div class="hand-grid">
            <div
              v-for="card in hand"
              :key="card.id"
              class="hand-card"
              :class="card.type.toLowerCase()"
            >
              <div class="card-body">
                <template v-if="card.type === 'LETTER'">
                  <span class="card-title">{{ card.letter }}</span>
                  <small v-if="card.penalty > 0">
                    +{{ card.penalty }}
                  </small>
                </template>
                <template v-else>
                  <span class="card-title">{{ formatAction(card.action) }}</span>
                </template>
              </div>
              <b-button
                type="is-primary is-small"
                :disabled="!isCurrentPlayer"
                @click="playCard(card)"
              >
                {{ $t('Play') }}
              </b-button>
            </div>
          </div>
        </div>
      </div>

      <div class="card events" v-if="events.length">
        <header class="card-header">
          <p class="card-header-title">
            <vue-fontawesome icon="clipboard" class="mr-2" />
            {{ $t('Latest actions') }}
          </p>
        </header>
        <div class="card-content">
          <ul>
            <li v-for="(event, index) in events" :key="index">
              <span class="event-time">{{ relativeEventTime(event.timestamp) }}</span>
              <span class="event-body">{{ renderEvent(event) }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div class="column is-4">
      <div class="box info-panel">
        <h3 class="title is-5">{{ $t('Turn') }}</h3>
        <p>
          <strong>{{ $t('Current player') }}:</strong>
          <span>{{ playerName(currentPlayer) }}</span>
        </p>
        <p>
          <strong>{{ $t('Time left') }}:</strong>
          <span>{{ formattedTimeLeft }}</span>
        </p>
        <p>
          <strong>{{ $t('Direction') }}:</strong>
          <span>{{ directionLabel }}</span>
        </p>
      </div>
      <div class="box scoreboard" v-if="scores.length">
        <h3 class="title is-5">
          <vue-fontawesome icon="award" class="mr-2" />
          {{ $t('Scoreboard') }}
        </h3>
        <ul>
          <li v-for="score in scores" :key="score.uuid">
            <span>{{ playerName(score.uuid) }}</span>
            <span class="points">{{ score.points }}</span>
          </li>
        </ul>
      </div>
      <div class="box" v-if="roundWinner">
        <h3 class="title is-6">{{ $t('Round won by {name}', { name: playerName(roundWinner) }) }}</h3>
      </div>
      <div class="box" v-if="gameWinner">
        <h3 class="title is-5">{{ $t('Game won by {name}!', { name: playerName(gameWinner) }) }}</h3>
        <b-button type="is-primary" @click="askRestart" v-if="isMaster">
          <vue-fontawesome icon="redo-alt" class="mr-2" />
          {{ $t('Restart the game') }}
        </b-button>
      </div>
    </div>
  </section>
</template>

<script>
import { mapState, mapGetters } from "vuex";

export default {
  data() {
    return {
      now: Date.now(),
      timerInterval: null
    };
  },
  computed: {
    ...mapState({
      hand: state => state.game.hand,
      events: state => state.game.events,
      roundWinner: state => state.game.roundWinner,
      gameWinner: state => state.game.gameWinner,
      currentPlayer: state => state.game.currentPlayer,
      round: state => state.game.round,
      list: state => state.game.list,
      players: state => state.morel.players,
      direction: state => state.game.direction
    }),
    ...mapGetters(["ordered_scores", "is_current_player", "time_left_ms"]),
    ...mapState("morel", {
      isMaster: state => state.master
    }),
    scores() {
      return this.ordered_scores;
    },
    isCurrentPlayer() {
      return this.is_current_player;
    },
    formattedTimeLeft() {
      // Accessing `now` ensures the interval refreshes the computed value.
      void this.now;
      const ms = Math.max(0, this.time_left_ms);
      const total = Math.floor(ms / 1000);
      const minutes = Math.floor(total / 60)
        .toString()
        .padStart(2, "0");
      const seconds = (total % 60).toString().padStart(2, "0");
      return `${minutes}:${seconds}`;
    },
    directionLabel() {
      return this.direction > 0 ? this.$t("Clockwise") : this.$t("Counter-clockwise");
    }
  },
  methods: {
    formatAction(action) {
      switch (action) {
        case "STOP":
          return this.$t("STOP");
        case "SWITCH":
          return this.$t("SWITCH");
        case "SWAP":
          return this.$t("SWAP");
        case "CRACK_LIST":
          return this.$t("CRACK LIST");
        default:
          return action;
      }
    },
    playerName(uuid) {
      const player = this.players[uuid];
      return player ? player.pseudonym : this.$t("Unknown");
    },
    playCard(card) {
      if (card.type === "LETTER") {
        this.$buefy.dialog.prompt({
          title: this.$t("Answer starting with {letter}", { letter: card.letter }),
          message: this.$t("Enter your answer"),
          inputAttrs: {
            maxlength: 64
          },
          trapFocus: true,
          confirmText: this.$t("Play"),
          cancelText: this.$t("Cancel"),
          onConfirm: answer => {
            this.$store.dispatch("play_card", {
              cardId: card.id,
              answer
            });
          }
        });
      } else {
        this.$buefy.dialog.confirm({
          title: this.$t("Play action card"),
          message: this.$t("Play {action}?", { action: this.formatAction(card.action) }),
          confirmText: this.$t("Play"),
          cancelText: this.$t("Cancel"),
          onConfirm: () =>
            this.$store.dispatch("play_card", {
              cardId: card.id
            })
        });
      }
    },
    renderEvent(event) {
      const author = this.playerName(event.player);
      switch (event.type) {
        case "card":
          if (event.card.type === "LETTER") {
            return this.$t("{player} played {letter}: {answer}", {
              player: author,
              letter: event.card.letter,
              answer: event.answer
            });
          }
          return this.$t("{player} played {action}", {
            player: author,
            action: this.formatAction(event.card.action)
          });
        case "penalty":
          return this.$t("{player} gave {count} penalty cards", {
            player: author,
            count: event.amount
          });
        case "penalty-draw":
          return this.$t("{player} drew {count} cards", {
            player: author,
            count: event.amount
          });
        case "answer-refused":
          return this.$t(this.answerRefusedKey(event.reason), { player: author });
        case "timeout":
          return this.$t("{player} ran out of time", { player: author });
        case "list":
          return this.$t("{player} cracked a new list: {list}", {
            player: author,
            list: event.list
          });
        case "skip":
          return this.$t("{player} played STOP", { player: author });
        default:
          return "";
      }
    },
    answerRefusedKey(reason) {
      switch (reason) {
        case "empty":
          return "{player} did not give an answer";
        case "invalid-letter":
          return "{player}'s answer did not start with the right letter";
        case "duplicate":
          return "{player}'s answer was already used";
        default:
          return "{player}'s answer was refused";
      }
    },
    relativeEventTime(timestamp) {
      if (!timestamp) return "";
      const delta = Math.floor((Date.now() - timestamp) / 1000);
      if (delta < 5) return this.$t("just now");
      if (delta < 60) return this.$t("{n}s ago", { n: delta });
      const minutes = Math.floor(delta / 60);
      return this.$t("{n}m ago", { n: minutes });
    },
    askRestart() {
      this.$store.dispatch("ask_restart_game");
    }
  },
  mounted() {
    this.timerInterval = setInterval(() => {
      this.now = Date.now();
    }, 500);
  },
  beforeDestroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
  }
};
</script>

<style lang="sass" scoped>
.cracklist-game
  .current-list
    display: inline-block
    margin-left: .5rem

  .round-tag
    margin-left: 1rem
    font-weight: 600

  .hand-grid
    display: grid
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))
    grid-gap: 1rem

  .hand-card
    background: hsla(0, 0%, 97%, 1)
    border-radius: .5rem
    padding: 1rem
    text-align: center
    box-shadow: 0 1px 3px hsla(0, 0%, 0%, .1)

    &.letter
      border: 2px solid #209cee
    &.action
      border: 2px solid #ff3860

    .card-title
      display: block
      font-size: 2rem
      font-weight: 700
      margin-bottom: .5rem

  .events
    margin-top: 1.5rem

    ul
      list-style: none
      padding: 0

      li
        margin-bottom: .5rem

    .event-time
      font-size: .8rem
      color: #888
      margin-right: .5rem

  .scoreboard ul
    list-style: none
    padding: 0

    li
      display: flex
      justify-content: space-between
      margin-bottom: .5rem

    .points
      font-weight: 700
</style>
