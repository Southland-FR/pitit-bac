<template>
  <div class="game-configuration">
    <b-message
      :title="master ? $t('Configure the game') : $t('Game configuration')"
      :closable="false"
      type="is-primary"
    >
      <section>
        <div class="columns">
          <div class="column is-half">
            <b-field :label="$t('Points to win')">
              <b-numberinput
                v-model.number="config.pointsToWin"
                :disabled="!master"
                :min="1"
                :max="9"
                @input="update_configuration"
              />
            </b-field>
            <b-field>
              <b-switch
                v-model="config.autoPenaltyDistribution"
                :disabled="!master"
                @input="update_configuration"
              >
                {{
                  $t(
                    'Distribute penalty cards automatically when no target is selected'
                  )
                }}
              </b-switch>
            </b-field>
          </div>
          <div class="column is-half is-flex is-align-items-center">
            <b-button
              type="is-primary is-medium"
              expanded
              :disabled="!master || players_online < 2"
              @click="start_game"
            >
              {{ $t('Start the game') }}
            </b-button>
          </div>
        </div>
      </section>
    </b-message>
  </div>
</template>

<script>
import { mapState, mapGetters } from "vuex";

export default {
  computed: {
    ...mapState("morel", {
      master: state => state.master,
      config: state => state.configuration
    }),
    ...mapGetters("morel", ["players_count_online"]),
    players_online() {
      return this.players_count_online;
    }
  },
  methods: {
    update_configuration() {
      if (!this.master) return;
      this.$nextTick(() =>
        this.$store.dispatch("morel/update_game_configuration", this.config)
      );
    },
    start_game() {
      this.$store.dispatch("ask_start_game");
    }
  }
};
</script>

<style lang="sass" scoped>
.game-configuration
  .message
    box-shadow: 0 1px 3px hsla(0, 0%, 0%, .12), 0 1px 2px hsla(0, 0%, 0%, .24)

  .column
    display: flex
    flex-direction: column

  .b-field
    margin-bottom: 1.5rem
</style>
