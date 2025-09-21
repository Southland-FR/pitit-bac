import { crack_list as crackList, is_answer_valid, compare_answers } from "ptitbac-commons";
import { log_info } from "../logging";

const HAND_SIZE = 8;
const TURN_DURATION_MS = 20_000;
const LAST_CARD_TURN_DURATION_MS = 10_000;
const POINTS_TO_WIN = 3;

export class CrackListGame {
  constructor(slug, server) {
    this.slug = slug;
    this.server = server;

    this.players = {};
    this.master_player_uuid = null;
    this.locked = false;

    this.state = "CONFIG";
    this.configuration = {
      pointsToWin: POINTS_TO_WIN,
      autoPenaltyDistribution: true
    };

    this.hands = {};
    this.redDeck = [];
    this.redDiscard = [];
    this.blueDeck = [];
    this.blueDiscard = [];

    this.turnOrder = [];
    this.turnDirection = 1;
    this.currentPlayerIndex = 0;
    this.skipNext = false;

    this.turnTimer = null;
    this.turnDeadline = null;

    this.currentListCard = null;
    this.currentList = null;

    this.answersHistory = [];
    this.scores = {};
    this.roundNumber = 0;

    this.pending_deletion_task = null;
    this.pending_deletion_threshold = 1000 * 60 * 20;

    this.just_created = true;
  }

  log(message) {
    log_info(`[${this.slug}] ${message}`);
  }

  static clean_player_for_users(player) {
    return {
      uuid: player.uuid,
      pseudonym: player.pseudonym,
      ready: !!player.ready,
      master: !!player.master,
      online: !!player.online
    };
  }

  broadcast(action, message) {
    this.online_players()
      .filter(player => player.connection)
      .forEach(player => this.server.send_message(player.connection, action, message));
  }

  send_message(uuid, action, message) {
    const player = this.players[uuid];
    if (!player || !player.online || !player.connection) return;

    return this.server.send_message(player.connection, action, message);
  }

  online_players() {
    return Object.values(this.players).filter(player => player.online);
  }

  online_players_uuids() {
    return this.online_players().map(player => player.uuid);
  }

  start_deletion_process() {
    this.pending_deletion_task = setTimeout(() => {
      this.log(`${this.pending_deletion_threshold / 1000} seconds without players: destroying game.`);
      this.server.delete_game(this.slug);
    }, this.pending_deletion_threshold);
  }

  halt_deletion_process() {
    if (this.pending_deletion_task) {
      clearTimeout(this.pending_deletion_task);
      this.pending_deletion_task = null;
    }
  }

  is_valid_player(uuid) {
    return !!this.players[uuid];
  }

  join(connection, uuid, pseudonym) {
    const master_player = this.online_players().length === 0 || this.master_player_uuid === uuid;
    let player = this.players[uuid];

    if (player && !player.online) {
      player.online = true;
      player.connection = connection;
      player.pseudonym = pseudonym;
      player.master = master_player;
    }
    else {
      if (this.locked) {
        this.kick(uuid, true, connection);
        return;
      }

      player = {
        connection,
        uuid,
        pseudonym,
        ready: true,
        online: true,
        master: master_player
      };

      this.players[uuid] = player;
      this.server.increment_statistic("players");
    }

    if (master_player) {
      this.master_player_uuid = player.uuid;
    }

    this.broadcast("player-join", { player: CrackListGame.clean_player_for_users(player) });

    this.catch_up(uuid);
    this.update_master_presence();
    this.just_created = false;

    this.halt_deletion_process();
  }

  left(uuid) {
    const player = this.players[uuid];
    if (!player) return;

    player.online = false;
    player.connection = null;

    const idx = this.turnOrder.indexOf(uuid);
    if (idx !== -1) {
      this.turnOrder.splice(idx, 1);
      delete this.hands[uuid];

      if (this.state === "TURN") {
        if (idx < this.currentPlayerIndex) {
          this.currentPlayerIndex = Math.max(0, this.currentPlayerIndex - 1);
        }

        if (this.turnTimer) {
          clearTimeout(this.turnTimer);
          this.turnTimer = null;
        }

        if (this.turnOrder.length > 0) {
          this.currentPlayerIndex = this.currentPlayerIndex % this.turnOrder.length;
          const currentUuid = this.turnOrder[this.currentPlayerIndex];
          const duration = this.current_turn_duration();
          this.arm_turn_timer(currentUuid, duration);
          this.broadcast("turn-started", {
            player: currentUuid,
            deadline: this.turnDeadline,
            duration,
            list: this.currentList,
            round: this.roundNumber
          });
        } else {
          this.turnDeadline = null;
        }
      }
    }

    this.broadcast("player-left", { player: { uuid } });

    if (this.online_players().length === 0) {
      this.start_deletion_process();
    }
  }

  kick(target_uuid, locked = false, connection = null) {
    if (!this.players[target_uuid]) return;

    const message = { locked };
    const sendTo = connection || this.players[target_uuid].connection;
    if (sendTo) {
      this.server.send_message(sendTo, "kick", message);
    }

    delete this.players[target_uuid];
    delete this.hands[target_uuid];
    delete this.scores[target_uuid];

    this.broadcast("player-left", { player: { uuid: target_uuid } });
  }

  set_lock(uuid, locked) {
    if (this.master_player_uuid !== uuid) return;
    this.locked = locked;
    this.broadcast("game-locked", { locked: this.locked });
  }

  kick_by_master(uuid, target_uuid) {
    if (this.master_player_uuid !== uuid) return;
    this.kick(target_uuid, false);
  }

  update_master_presence() {
    if (!this.players[this.master_player_uuid] || !this.players[this.master_player_uuid].online) {
      this.elect_random_master();
    }
  }

  elect_random_master() {
    const online = this.online_players_uuids();
    if (online.length === 0) {
      this.master_player_uuid = null;
      return;
    }

    const new_master = online[Math.floor(Math.random() * online.length)];
    this.elect_master(new_master);
  }

  elect_master(new_master_uuid) {
    const old_master = this.players[this.master_player_uuid];
    const new_master = this.players[new_master_uuid];
    if (!new_master) return;

    if (old_master) old_master.master = false;

    new_master.master = true;
    this.master_player_uuid = new_master_uuid;
    this.broadcast("set-master", { master: { uuid: this.master_player_uuid } });
  }

  switch_master(uuid, new_master_uuid) {
    if (this.master_player_uuid !== uuid) return;
    this.elect_master(new_master_uuid);
  }

  update_configuration(uuid, configuration) {
    if (this.state !== "CONFIG") return;
    if (!this.is_valid_player(uuid)) return;
    if (this.master_player_uuid !== uuid) {
      this.send_message(uuid, "config-updated", { configuration: this.configuration });
      return;
    }

    const parsed = {
      pointsToWin: Math.max(1, parseInt(configuration.pointsToWin, 10) || POINTS_TO_WIN),
      autoPenaltyDistribution: configuration.autoPenaltyDistribution !== false
    };

    this.configuration = parsed;
    this.broadcast("config-updated", { configuration: this.configuration });
  }

  start(connection, uuid) {
    if (!this.is_valid_player(uuid)) return;
    if (this.master_player_uuid !== uuid) return;
    if (this.online_players().length < 2) return;

    this.log("Starting Crack List game");
    this.server.increment_statistic("games");
    this.setup_new_round();
  }

  setup_new_round(startingPlayerUuid = null) {
    this.state = "ROUND_SETUP";
    this.roundNumber += 1;
    this.server.increment_statistic("rounds");
    this.answersHistory = [];

    this.redDeck = crackList.createRedDeck();
    this.redDiscard = [];
    this.blueDeck = crackList.createBlueDeck();
    this.blueDiscard = [];

    this.turnOrder = this.online_players_uuids();
    if (this.turnOrder.length === 0) {
      this.start_deletion_process();
      return;
    }

    this.turnOrder = this.shuffle_array(this.turnOrder);

    if (startingPlayerUuid && this.turnOrder.includes(startingPlayerUuid)) {
      while (this.turnOrder[0] !== startingPlayerUuid) {
        this.turnOrder.push(this.turnOrder.shift());
      }
    }

    this.turnDirection = 1;
    this.currentPlayerIndex = 0;
    this.skipNext = false;
    this.turnDeadline = null;

    this.hands = {};
    this.turnOrder.forEach(uuid => {
      const { drawn, remaining } = crackList.drawCards(this.redDeck, HAND_SIZE);
      this.redDeck = remaining;
      this.hands[uuid] = drawn;
      this.send_hand(uuid);
    });

    const { drawn: listCards, remaining: remainingBlue } = crackList.drawCards(this.ensure_blue_deck(), 1);
    this.blueDeck = remainingBlue;
    this.currentListCard = listCards[0];
    this.blueDiscard.push(this.currentListCard);
    this.currentList = this.pick_list_option(this.currentListCard);

    this.broadcast_state();
    this.start_turn_cycle();
  }

  shuffle_array(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  ensure_red_deck() {
    if (this.redDeck.length > 0) return;
    this.redDeck = crackList.ensureDeck(this.redDeck, this.redDiscard);
  }

  ensure_blue_deck() {
    if (this.blueDeck.length === 0) {
      this.blueDeck = crackList.ensureDeck(this.blueDeck, this.blueDiscard);
    }
    return this.blueDeck;
  }

  send_hand(uuid) {
    this.send_message(uuid, "hand-updated", {
      hand: this.hands[uuid] || []
    });
  }

  broadcast_state() {
    this.broadcast("catch-up-game-state", {
      state: this.state,
      round: this.roundNumber,
      list: this.currentList,
      players: this.turnOrder,
      currentPlayer: this.turnOrder[this.currentPlayerIndex],
      direction: this.turnDirection,
      scores: this.scores,
      deadline: this.turnDeadline,
      duration: this.state === "TURN" ? this.current_turn_duration() : null,
      configuration: this.configuration
    });
  }

  catch_up(uuid) {
    this.send_message(uuid, "catch-up-game-state", {
      state: this.state,
      round: this.roundNumber,
      list: this.currentList,
      players: this.turnOrder,
      currentPlayer: this.turnOrder[this.currentPlayerIndex],
      direction: this.turnDirection,
      scores: this.scores,
      deadline: this.turnDeadline,
      duration: this.state === "TURN" ? this.current_turn_duration() : null,
      configuration: this.configuration
    });

    this.send_hand(uuid);
  }

  current_turn_duration() {
    const currentUuid = this.turnOrder[this.currentPlayerIndex];
    if (!currentUuid) return TURN_DURATION_MS;
    const hand = this.hands[currentUuid] || [];
    return hand.length === 1 ? LAST_CARD_TURN_DURATION_MS : TURN_DURATION_MS;
  }

  start_turn_cycle() {
    this.state = "TURN";
    this.advance_to_next_playable_player(false);
  }

  advance_to_next_playable_player(advanceIndex = true) {
    if (advanceIndex) {
      this.currentPlayerIndex = this.compute_next_index(1);
    }

    if (this.skipNext) {
      this.skipNext = false;
      this.currentPlayerIndex = this.compute_next_index(1);
    }

    if (this.turnOrder.length === 0) {
      this.start_deletion_process();
      return;
    }

    const currentUuid = this.turnOrder[this.currentPlayerIndex];
    const duration = this.current_turn_duration();

    this.arm_turn_timer(currentUuid, duration);

    this.broadcast("turn-started", {
      player: currentUuid,
      deadline: this.turnDeadline,
      duration,
      list: this.currentList,
      round: this.roundNumber
    });
  }

  compute_next_index(step) {
    const length = this.turnOrder.length;
    if (length === 0) return 0;

    const newIndex = (this.currentPlayerIndex + step * this.turnDirection) % length;
    return (newIndex + length) % length;
  }

  arm_turn_timer(uuid, duration) {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }

    this.turnDeadline = Date.now() + duration;
    this.turnTimer = setTimeout(() => this.handle_turn_timeout(uuid), duration);
  }

  handle_turn_timeout(uuid) {
    this.turnTimer = null;

    this.log(`Player ${uuid} timed out.`);
    this.apply_penalty_draw(uuid, 1, "timeout");
    this.broadcast("turn-timeout", { player: uuid });
    this.advance_to_next_playable_player(true);
  }

  play_card(uuid, payload) {
    if (this.state !== "TURN") return;
    if (!this.is_current_player(uuid)) return;

    const card = this.find_card(uuid, payload.cardId);
    if (!card) return;

    if (card.type === "LETTER") {
      this.process_letter_card(uuid, card, payload);
    }
    else {
      this.process_action_card(uuid, card, payload);
    }
  }

  is_current_player(uuid) {
    return this.turnOrder[this.currentPlayerIndex] === uuid;
  }

  find_card(uuid, cardId) {
    const hand = this.hands[uuid] || [];
    return hand.find(card => card.id === cardId);
  }

  remove_card_from_hand(uuid, cardId) {
    const hand = this.hands[uuid] || [];
    const index = hand.findIndex(card => card.id === cardId);
    if (index === -1) return null;
    const [card] = hand.splice(index, 1);
    this.hands[uuid] = hand;
    this.send_hand(uuid);
    return card;
  }

  process_letter_card(uuid, card, payload) {
    const answer = (payload && payload.answer || "").trim();

    if (!answer) {
      this.handle_invalid_answer(uuid, card, "empty");
      return;
    }

    if (!is_answer_valid(card.letter, answer)) {
      this.handle_invalid_answer(uuid, card, "invalid-letter");
      return;
    }

    if (this.answersHistory.some(entry => compare_answers(entry.answer, answer))) {
      this.handle_invalid_answer(uuid, card, "duplicate");
      return;
    }

    const removed = this.remove_card_from_hand(uuid, card.id);
    if (!removed) return;

    this.redDiscard.push(removed);
    this.answersHistory.push({
      uuid,
      letter: card.letter,
      answer
    });

    const penalty = card.penalty || 0;
    const penaltyTargets = this.choose_penalty_targets(uuid, penalty);
    penaltyTargets.forEach(targetUuid => this.draw_cards_for_player(targetUuid, 1));

    if (penalty > 0) {
      this.broadcast("penalty-applied", {
        player: uuid,
        amount: penalty,
        targets: penaltyTargets
      });
    }

    this.broadcast("card-played", {
      player: uuid,
      card: {
        type: "LETTER",
        letter: card.letter,
        penalty
      },
      answer
    });

    if (this.hands[uuid].length === 0) {
      this.handle_round_win(uuid);
    }
    else {
      this.advance_to_next_playable_player(true);
    }
  }

  handle_invalid_answer(uuid, card, reason) {
    this.broadcast("answer-refused", { player: uuid, reason });
    this.apply_penalty_draw(uuid, 1, reason);
    this.advance_to_next_playable_player(true);
  }

  apply_penalty_draw(uuid, amount, reason) {
    this.draw_cards_for_player(uuid, amount);
    this.broadcast("penalty-draw", { player: uuid, amount, reason });
  }

  draw_cards_for_player(uuid, amount) {
    if (!this.hands[uuid]) {
      this.hands[uuid] = [];
    }

    for (let i = 0; i < amount; i++) {
      this.ensure_red_deck();
      if (this.redDeck.length === 0) break;
      const card = this.redDeck.shift();
      this.hands[uuid].push(card);
    }

    this.send_hand(uuid);
  }

  choose_penalty_targets(authorUuid, amount) {
    if (amount <= 0) return [];

    const opponents = this.turnOrder.filter(uuid => uuid !== authorUuid);
    if (opponents.length === 0) return [];

    const targets = [];
    for (let i = 0; i < amount; i++) {
      const target = opponents[(this.currentPlayerIndex + 1 + i) % opponents.length];
      targets.push(target);
    }
    return targets;
  }

  process_action_card(uuid, card, payload) {
    const removed = this.remove_card_from_hand(uuid, card.id);
    if (!removed) return;

    this.redDiscard.push(removed);

    switch (card.action) {
      case "SWITCH":
        this.turnDirection *= -1;
        this.broadcast("direction-changed", { direction: this.turnDirection });
        break;

      case "STOP":
        this.skipNext = true;
        this.broadcast("skip-next", { player: uuid });
        break;

      case "SWAP":
        this.handle_swap(uuid, payload && payload.targetUuid);
        break;

      case "CRACK_LIST":
        this.handle_crack_list(uuid);
        break;
    }

    if (this.hands[uuid].length === 0) {
      this.draw_cards_for_player(uuid, 1);
    }

    this.broadcast("card-played", {
      player: uuid,
      card: {
        type: "ACTION",
        action: card.action
      }
    });

    this.advance_to_next_playable_player(true);
  }

  handle_swap(authorUuid, targetUuid) {
    if (!targetUuid || !this.hands[targetUuid]) {
      const opponents = this.turnOrder.filter(uuid => uuid !== authorUuid);
      targetUuid = opponents[0];
    }

    const authorHand = this.hands[authorUuid] || [];
    const targetHand = this.hands[targetUuid] || [];

    this.hands[authorUuid] = targetHand;
    this.hands[targetUuid] = authorHand;

    this.send_hand(authorUuid);
    this.send_hand(targetUuid);

    this.broadcast("hands-swapped", {
      author: authorUuid,
      target: targetUuid,
      sizes: {
        [authorUuid]: this.hands[authorUuid].length,
        [targetUuid]: this.hands[targetUuid].length
      }
    });
  }

  handle_crack_list(uuid) {
    const { drawn, remaining } = crackList.drawCards(this.ensure_blue_deck(), 1);
    this.blueDeck = remaining;
    this.currentListCard = drawn[0];
    this.blueDiscard.push(this.currentListCard);
    this.currentList = this.pick_list_option(this.currentListCard);

    this.broadcast("list-changed", {
      player: uuid,
      list: this.currentList
    });
  }

  pick_list_option(card) {
    if (!card || !Array.isArray(card.options) || card.options.length === 0) {
      return "";
    }

    const index = Math.floor(Math.random() * card.options.length);
    return card.options[index];
  }

  handle_round_win(uuid) {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
    this.state = "ROUND_END";

    this.scores[uuid] = (this.scores[uuid] || 0) + 1;

    this.broadcast("round-ended", {
      winner: uuid,
      scores: this.scores
    });

    if (this.scores[uuid] >= this.configuration.pointsToWin) {
      this.end_game(uuid);
    }
    else {
      setTimeout(() => this.setup_new_round(uuid), 2000);
    }
  }

  end_game(winnerUuid) {
    this.state = "END";
    this.broadcast("game-ended", {
      winner: winnerUuid,
      scores: this.scores
    });
  }

  restart(uuid) {
    if (uuid !== this.master_player_uuid) return;

    this.state = "CONFIG";
    this.roundNumber = 0;
    this.scores = {};
    this.currentList = null;
    this.currentListCard = null;
    this.turnOrder = [];
    this.hands = {};
    this.turnDeadline = null;
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }

    Object.values(this.players)
      .filter(player => !player.online)
      .map(player => player.uuid)
      .forEach(playerUuid => delete this.players[playerUuid]);

    this.broadcast("game-restarted", {});
    this.broadcast("config-updated", { configuration: this.configuration });
  }
}
