import { MorelClient } from "morel-games-core";

export default class GameClient extends MorelClient {
  message_in_catch_up_game_state(message) {
    this.store.dispatch("catch_up", message);
  }

  message_in_config_updated({ configuration }) {
    this.store.commit("morel/update_configuration", configuration);
  }

  message_in_hand_updated({ hand }) {
    this.store.commit("set_hand", hand || []);
  }

  message_in_turn_started({ player, deadline, duration, list, round }) {
    this.store.dispatch("turn_started", { player, deadline, duration, list, round });
  }

  message_in_card_played({ player, card, answer }) {
    this.store.dispatch("card_played", { player, card, answer });
  }

  message_in_penalty_applied({ player, amount, targets }) {
    this.store.dispatch("penalty_applied", { player, amount, targets });
  }

  message_in_penalty_draw({ player, amount, reason }) {
    this.store.dispatch("penalty_draw", { player, amount, reason });
  }

  message_in_answer_refused({ player, reason }) {
    this.store.dispatch("answer_refused", { player, reason });
  }

  message_in_turn_timeout({ player }) {
    this.store.dispatch("turn_timeout", { player });
  }

  message_in_direction_changed({ direction }) {
    this.store.commit("set_direction", direction);
  }

  message_in_skip_next({ player }) {
    this.store.dispatch("skip_next", { player });
  }

  message_in_list_changed({ player, list }) {
    this.store.dispatch("list_changed", { player, list });
  }

  message_in_round_ended({ winner, scores }) {
    this.store.dispatch("round_ended", { winner, scores });
  }

  message_in_game_restarted() {
    this.store.dispatch("restart_game_state");
  }

  message_in_game_ended({ winner, scores }) {
    this.store.dispatch("game_ended", { winner, scores });
  }

  play_card(card) {
    return this.send_message("play-card", {
      card
    });
  }

  ask_start_game() {
    return this.send_message("start-game", {});
  }

  restart_game() {
    return this.send_message("restart", {});
  }
}
