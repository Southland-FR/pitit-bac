import Vue from "vue";
import Vuex from "vuex";

import { MorelStore, MorelVue, MorelI18n } from "morel-games-core";

import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faCheck,
  faExclamationCircle,
  faLockOpen,
  faLock,
  faChevronRight,
  faCaretUp,
  faCaretDown,
  faTimes,
  faHourglassHalf,
  faUserAltSlash,
  faUserShield,
  faClipboard,
  faAward,
  faStopwatch,
  faRedoAlt
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

import Buefy from "buefy";
import "buefy/dist/buefy.css";

import GameClient from "./game";
import App from "./App.vue";

Vue.use(Vuex);
Vue.use(Buefy, {
  defaultIconComponent: "vue-fontawesome",
  defaultIconPack: "fas"
});
Vue.use(MorelVue);

Vue.config.productionTip = false;

library.add(
  faCheck,
  faExclamationCircle,
  faLockOpen,
  faLock,
  faChevronRight,
  faCaretUp,
  faCaretDown,
  faTimes,
  faHourglassHalf,
  faUserAltSlash,
  faUserShield,
  faClipboard,
  faAward,
  faStopwatch,
  faRedoAlt
);

Vue.component("vue-fontawesome", FontAwesomeIcon);

const client = new GameClient(
  process.env.VUE_APP_WS_URL.replace("{hostname}", document.location.hostname),
  "pb-protocol"
);

const i18n = new MorelI18n(
  locale =>
    import(
      /* webpackChunkName: "locales-[request]" */ "./../locales/" +
        locale +
        ".json"
    ),
  {
    en: "English",
    fr: "Français"
  }
);

const store = new Vuex.Store({
  modules: {
    morel: MorelStore(client, i18n)
  },
  state: {
    game: {
      round: 0,
      list: null,
      currentPlayer: null,
      direction: 1,
      timer: {
        deadline: null,
        duration: 0
      },
      hand: [],
      scores: {},
      events: [],
      lastPlayed: null,
      roundWinner: null,
      gameWinner: null
    },
    sticky_players_list: false
  },
  getters: {
    is_current_player: (state, getters, rootState) =>
      state.game.currentPlayer === rootState.morel.uuid,
    time_left_ms: state =>
      state.game.timer.deadline
        ? Math.max(0, state.game.timer.deadline - Date.now())
        : 0,
    ordered_scores: state =>
      Object.entries(state.game.scores)
        .map(([uuid, points]) => ({ uuid, points }))
        .sort((a, b) => b.points - a.points)
  },
  mutations: {
    set_sticky_players_list(state, fixed) {
      state.sticky_players_list = fixed;
    },

    set_hand(state, hand) {
      state.game.hand = hand;
    },

    set_round(state, round) {
      state.game.round = round;
    },

    set_list(state, list) {
      state.game.list = list;
    },

    set_current_player(state, uuid) {
      state.game.currentPlayer = uuid;
    },

    set_direction(state, direction) {
      state.game.direction = direction;
    },

    set_timer(state, { deadline, duration }) {
      state.game.timer.deadline = deadline;
      state.game.timer.duration = duration;
    },

    append_event(state, event) {
      const enriched = {
        timestamp: Date.now(),
        ...event
      };
      state.game.events.unshift(enriched);
      state.game.events = state.game.events.slice(0, 50);
    },

    set_scores(state, scores) {
      state.game.scores = { ...scores };
    },

    set_round_winner(state, winner) {
      state.game.roundWinner = winner;
    },

    set_game_winner(state, winner) {
      state.game.gameWinner = winner;
    },

    clear_winners(state) {
      state.game.roundWinner = null;
      state.game.gameWinner = null;
    },

    reset_round_state(state) {
      state.game.currentPlayer = null;
      state.game.list = null;
      state.game.timer = {
        deadline: null,
        duration: 0
      };
      state.game.events = [];
      state.game.lastPlayed = null;
      state.game.roundWinner = null;
    },

    reset_game_state(state) {
      state.game.round = 0;
      state.game.list = null;
      state.game.currentPlayer = null;
      state.game.direction = 1;
      state.game.timer = {
        deadline: null,
        duration: 0
      };
      state.game.hand = [];
      state.game.scores = {};
      state.game.events = [];
      state.game.lastPlayed = null;
      state.game.roundWinner = null;
      state.game.gameWinner = null;
    }
  },
  actions: {
    ask_start_game() {
      client.ask_start_game();
    },

    ask_restart_game() {
      client.restart_game();
    },

    play_card(context, card) {
      client.play_card(card);
    },

    catch_up(context, payload) {
      if (payload.configuration) {
        context.commit("morel/update_configuration", payload.configuration);
      }

      if (payload.round) {
        context.commit("set_round", payload.round);
      }

      if (payload.list) {
        context.commit("set_list", payload.list);
      }

      if (payload.currentPlayer) {
        context.commit("set_current_player", payload.currentPlayer);
      }

      if (payload.direction) {
        context.commit("set_direction", payload.direction);
      }

      if (payload.scores) {
        context.commit("set_scores", payload.scores);
      }

      if (payload.deadline) {
        context.commit("set_timer", {
          deadline: payload.deadline,
          duration: payload.duration || 0
        });
      }

      if (payload.state === "TURN" || payload.state === "ROUND_SETUP") {
        context.commit("morel/set_phase", "PLAY");
      } else if (payload.state === "ROUND_END") {
        context.commit("morel/set_phase", "ROUND_END");
      } else if (payload.state === "END") {
        context.commit("morel/set_phase", "END");
      } else {
        context.commit("morel/set_phase", "CONFIG");
      }
    },

    turn_started(context, { player, deadline, duration, list, round }) {
      context.commit("set_round", round);
      context.commit("set_list", list);
      context.commit("set_current_player", player);
      context.commit("set_timer", { deadline, duration });
      context.commit("clear_winners");
      context.commit("morel/set_phase", "PLAY");
    },

    card_played(context, event) {
      context.commit("append_event", {
        type: "card",
        ...event
      });
    },

    penalty_applied(context, event) {
      context.commit("append_event", {
        type: "penalty",
        ...event
      });
    },

    penalty_draw(context, event) {
      context.commit("append_event", {
        type: "penalty-draw",
        ...event
      });
    },

    answer_refused(context, event) {
      context.commit("append_event", {
        type: "answer-refused",
        ...event
      });
    },

    turn_timeout(context, event) {
      context.commit("append_event", {
        type: "timeout",
        ...event
      });
    },

    list_changed(context, { player, list }) {
      context.commit("set_list", list);
      context.commit("append_event", { type: "list", player, list });
    },

    skip_next(context, event) {
      context.commit("append_event", { type: "skip", ...event });
    },

    round_ended(context, { winner, scores }) {
      context.commit("set_scores", scores);
      context.commit("set_round_winner", winner);
      context.commit("set_timer", { deadline: null, duration: 0 });
      context.commit("morel/set_phase", "ROUND_END");
    },

    game_ended(context, { winner, scores }) {
      context.commit("set_scores", scores);
      context.commit("set_game_winner", winner);
      context.commit("set_timer", { deadline: null, duration: 0 });
      context.commit("morel/set_phase", "END");
    },

    restart_game_state(context) {
      context.commit("reset_game_state");
      context.commit("morel/set_phase", "CONFIG");
    }
  }
});

client.set_store(store);
i18n.set_store(store);

i18n.load_locale_from_browser();

store.commit("morel/update_configuration", {
  pointsToWin: 3,
  autoPenaltyDistribution: true
});

const url_slug = window.location.pathname.slice(1).split("/")[0];
if (url_slug) {
  store.commit("morel/set_slug", url_slug);
  store.commit("morel/set_phase", "PSEUDONYM");
}

new Vue({
  store,
  render: h => h(App)
}).$mount("#app");
