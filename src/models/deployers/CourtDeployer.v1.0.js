const BaseDeployer = require('../shared/BaseDeployer')
const logger = require('../../helpers/logger')('CourtDeployer')
const { MAX_UINT64, tokenToString } = require('../../helpers/numbers')
const { DISPUTE_MANAGER_ID, JURORS_REGISTRY_ID, SUBSCRIPTIONS_ID, TREASURY_ID, VOTING_ID } = require('../../helpers/court-modules')

const VERSION = 'v1.0'

const VERIFICATION_HEADERS = [
  'Commit sha: c7bf36f004a2b0e11d7e14234cea7853fd3a523a',
  'GitHub repository: https://github.com/aragon/aragon-court',
  'Tool used for the deploy: https://github.com/aragon/aragon-network-deploy',
]

module.exports = class extends BaseDeployer {
  constructor(config, environment, output, verifier = undefined) {
    super(environment, output, verifier)
    this.config = config
  }

  async call() {
    await this.loadOrDeployCourt()
    await this.loadOrDeployDisputes()
    await this.loadOrDeployRegistry()
    await this.loadOrDeployVoting()
    await this.loadOrDeployTreasury()
    await this.loadOrDeploySubscriptions()
    await this.setModules()
    await this.transferGovernor()
    await this.verifyContracts()
  }

  async loadOrDeployCourt() {
    const { court } = this.previousDeploy
    const AragonCourt = await this.environment.getArtifact('AragonCourt', '@aragon/court')

    if (court && court.address) await this._loadAragonCourt(AragonCourt, court.address)
    else await this._deployAragonCourt(AragonCourt)
  }

  async loadOrDeployDisputes() {
    const { disputes } = this.previousDeploy
    const DisputeManager = await this.environment.getArtifact('DisputeManager', '@aragon/court')

    if (disputes && disputes.address) await this._loadDisputes(DisputeManager, disputes.address)
    else await this._deployDisputes(DisputeManager)
  }

  async loadOrDeployRegistry() {
    const { registry } = this.previousDeploy
    const JurorsRegistry = await this.environment.getArtifact('JurorsRegistry', '@aragon/court')

    if (registry && registry.address) await this._loadRegistry(JurorsRegistry, registry.address)
    else await this._deployRegistry(JurorsRegistry)
  }

  async loadOrDeployVoting() {
    const { voting } = this.previousDeploy
    const Voting = await this.environment.getArtifact('CRVoting', '@aragon/court')

    if (voting && voting.address) await this._loadVoting(Voting, voting.address)
    else await this._deployVoting(Voting)
  }

  async loadOrDeployTreasury() {
    const { treasury } = this.previousDeploy
    const Treasury = await this.environment.getArtifact('CourtTreasury', '@aragon/court')

    if (treasury && treasury.address) await this._loadTreasury(Treasury, treasury.address)
    else await this._deployTreasury(Treasury)
  }

  async loadOrDeploySubscriptions() {
    const { subscriptions } = this.previousDeploy
    const Subscriptions = await this.environment.getArtifact('CourtSubscriptions', '@aragon/court')

    if (subscriptions && subscriptions.address) await this._loadSubscriptions(Subscriptions, subscriptions.address)
    else await this._deploySubscriptions(Subscriptions)
  }

  async setModules() {
    const sender = await this.environment.getSender()
    const modulesGovernor = await this.court.getModulesGovernor()

    if (modulesGovernor === sender) {
      logger.info('Setting modules...')
      const ids = [DISPUTE_MANAGER_ID, TREASURY_ID, VOTING_ID, JURORS_REGISTRY_ID, SUBSCRIPTIONS_ID]
      const implementations = [this.disputes, this.treasury, this.voting, this.registry, this.subscriptions].map(i => i.address)
      await this.court.setModules(ids, implementations)
      logger.success('Modules set successfully')
    } else {
      logger.warn('Cannot set modules since sender is no longer the modules governor')
    }
  }

  async transferGovernor() {
    const sender = await this.environment.getSender()
    const currentGovernor = await this.court.getModulesGovernor()
    const { governor: { modules: governor } } = this.config

    if (currentGovernor === sender) {
      logger.info(`Transferring modules governor to ${governor} ...`)
      await this.court.changeModulesGovernor(governor.address)
      logger.success(`Modules governor transferred successfully to ${governor}`)
    } else if (currentGovernor === governor.address) {
      logger.success(`Modules governor is already set to ${governor}`)
    } else {
      logger.warn('Modules governor is already set to another address')
    }
  }

  async verifyContracts() {
    if (this.verifier) {
      await this._verifyAragonCourt()
      await this._verifyDisputes()
      await this._verifyRegistry()
      await this._verifyVoting()
      await this._verifyTreasury()
      await this._verifySubscriptions()
    }
  }

  /** loading methods **/

  async _loadAragonCourt(AragonCourt, address) {
    logger.warn(`Using previous deployed AragonCourt instance at ${address}`)
    this.court = await AragonCourt.at(address)
  }

  async _loadDisputes(DisputeManager, address) {
    logger.warn(`Using previous deployed DisputeManager instance at ${address}`)
    this.disputes = await DisputeManager.at(address)
  }

  async _loadRegistry(JurorsRegistry, address) {
    logger.warn(`Using previous deployed JurorsRegistry instance at ${address}`)
    this.registry = await JurorsRegistry.at(address)
  }

  async _loadVoting(Voting, address) {
    logger.warn(`Using previous deployed Voting instance at ${address}`)
    this.voting = await Voting.at(address)
  }

  async _loadTreasury(Treasury, address) {
    logger.warn(`Using previous deployed Treasury instance at ${address}`)
    this.treasury = await Treasury.at(address)
  }

  async _loadSubscriptions(Subscriptions, address) {
    logger.warn(`Using previous deployed Subscriptions instance at ${address}`)
    this.subscriptions = await Subscriptions.at(address)
  }

  /** deploying methods **/

  async _deployAragonCourt(AragonCourt) {
    this._printAragonCourtDeploy()
    const sender = await this.environment.getSender()
    const { clock, governor, court, jurors } = this.config

    if (!court.feeToken.address) {
      const erc20 = await this._deployERC20Mock(court.feeToken)
      court.feeToken.address = erc20.address
    }

    this.court = await AragonCourt.new(
      [clock.termDuration, clock.firstTermStartTime],
      [governor.funds.address, governor.config.address, sender],
      court.feeToken.address,
      [court.jurorFee, court.draftFee, court.settleFee],
      [court.evidenceTerms, court.commitTerms, court.revealTerms, court.appealTerms, court.appealConfirmTerms],
      [court.penaltyPct, court.finalRoundReduction],
      [court.firstRoundJurorsNumber, court.appealStepFactor, court.maxRegularAppealRounds, court.finalRoundLockTerms],
      [court.appealCollateralFactor, court.appealConfirmCollateralFactor],
      jurors.minActiveBalance
    )

    const { address, transactionHash } = this.court
    logger.success(`Created AragonCourt instance at ${address}`)
    this._saveDeploy({ court: { address, transactionHash, version: VERSION }})
  }

  async _deployDisputes(DisputeManager) {
    if (!this.court.address) throw Error('AragonCourt has not been deployed yet')
    this._printDisputesDeploy()
    this.disputes = await DisputeManager.new(this.court.address, this.config.court.maxJurorsPerDraftBatch, this.config.court.skippedDisputes)
    const { address, transactionHash } = this.disputes
    logger.success(`Created DisputeManager instance at ${address}`)
    this._saveDeploy({ disputes: { address, transactionHash, version: VERSION }})
  }

  async _deployRegistry(JurorsRegistry) {
    if (!this.court.address) throw Error('AragonCourt has not been deployed yet')
    const { court, jurors } = this.config

    const anj = jurors.token.address || this.anj.address
    const totalActiveBalanceLimit = jurors.minActiveBalance.mul(MAX_UINT64.div(court.finalRoundWeightPrecision))
    this._printRegistryDeploy(anj, totalActiveBalanceLimit)

    this.registry = await JurorsRegistry.new(this.court.address, anj, totalActiveBalanceLimit)
    const { address, transactionHash } = this.registry
    logger.success(`Created JurorsRegistry instance at ${address}`)
    this._saveDeploy({ registry: { address, transactionHash, version: VERSION }})
  }

  async _deployVoting(Voting) {
    if (!this.court.address) throw Error('AragonCourt has not been deployed yet')
    this._printVotingDeploy()
    this.voting = await Voting.new(this.court.address)
    const { address, transactionHash } = this.voting
    logger.success(`Created Voting instance at ${address}`)
    this._saveDeploy({ voting: { address, transactionHash, version: VERSION }})
  }

  async _deployTreasury(Treasury) {
    if (!this.court.address) throw Error('AragonCourt has not been deployed yet')
    this._printTreasuryDeploy()
    this.treasury = await Treasury.new(this.court.address)
    const { address, transactionHash } = this.treasury
    logger.success(`Created Treasury instance at ${address}`)
    this._saveDeploy({ treasury: { address, transactionHash, version: VERSION }})
  }

  async _deploySubscriptions(Subscriptions) {
    if (!this.court.address) throw Error('AragonCourt has not been deployed yet')
    this._printSubscriptionsDeploy()
    const { subscriptions } = this.config

    if (!subscriptions.feeToken.address) {
      const erc20 = await this._deployERC20Mock(subscriptions.feeToken)
      subscriptions.feeToken.address = erc20.address
    }

    this.subscriptions = await Subscriptions.new(
      this.court.address,
      subscriptions.periodDuration,
      subscriptions.feeToken.address,
      subscriptions.feeAmount,
      subscriptions.prePaymentPeriods,
      subscriptions.resumePrePaidPeriods,
      subscriptions.latePaymentPenaltyPct,
      subscriptions.governorSharePct
    )

    const { address, transactionHash } = this.subscriptions
    logger.success(`Created Subscriptions instance at ${address}`)
    this._saveDeploy({ subscriptions: { address, transactionHash, version: VERSION }})
  }

  /** verifying methods **/

  async _verifyAragonCourt() {
    const court = this.previousDeploy.court
    if (!court || !court.verification) {
      const url = await this.verifier.call(this.court, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = court
      this._saveDeploy({ court: { address, transactionHash, version, verification: url } })
    }
  }

  async _verifyDisputes() {
    const disputes = this.previousDeploy.disputes
    if (!disputes || !disputes.verification) {
      const url = await this.verifier.call(this.disputes, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = disputes
      this._saveDeploy({ disputes: { address, transactionHash, version, verification: url } })
    }
  }

  async _verifyRegistry() {
    const registry = this.previousDeploy.registry
    if (!registry || !registry.verification) {
      const url = await this.verifier.call(this.registry, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = registry
      this._saveDeploy({ registry: { address, transactionHash, version, verification: url } })
    }
  }

  async _verifyVoting() {
    const voting = this.previousDeploy.voting
    if (!voting || !voting.verification) {
      const url = await this.verifier.call(this.voting, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = voting
      this._saveDeploy({ voting: { address, transactionHash, version, verification: url } })
    }
  }

  async _verifyTreasury() {
    const treasury = this.previousDeploy.treasury
    if (!treasury || !treasury.verification) {
      const url = await this.verifier.call(this.treasury, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = treasury
      this._saveDeploy({ treasury: { address, transactionHash, version, verification: url } })
    }
  }

  async _verifySubscriptions() {
    const subscriptions = this.previousDeploy.subscriptions
    if (!subscriptions || !subscriptions.verification) {
      const url = await this.verifier.call(this.subscriptions, '@aragon/court', VERIFICATION_HEADERS)
      const { address, transactionHash, version } = subscriptions
      this._saveDeploy({ subscriptions: { address, transactionHash, version, verification: url } })
    }
  }

  /** logging methods **/

  _printAragonCourtDeploy() {
    const { clock, governor, court, jurors } = this.config
    logger.info(`Deploying AragonCourt contract ${VERSION} with config:`)
    logger.info(` - Funds governor:                          ${governor.funds.describe()}`)
    logger.info(` - Config governor:                         ${governor.config.describe()}`)
    logger.info(` - Modules governor:                        ${governor.modules.describe()} (initially sender)`)
    logger.info(` - Term duration:                           ${clock.termDuration.toString()} seconds`)
    logger.info(` - First term start time:                   ${new Date(clock.firstTermStartTime.toNumber() * 1000)}`)
    logger.info(` - Fee token:                               ${court.feeToken.symbol} at ${court.feeToken.address}`)
    logger.info(` - Juror fee:                               ${tokenToString(court.jurorFee, court.feeToken)}`)
    logger.info(` - Draft fee:                               ${tokenToString(court.draftFee, court.feeToken)}`)
    logger.info(` - Settle fee:                              ${tokenToString(court.settleFee, court.feeToken)}`)
    logger.info(` - Evidence terms:                          ${court.evidenceTerms.toString()}`)
    logger.info(` - Commit terms:                            ${court.commitTerms.toString()}`)
    logger.info(` - Reveal terms:                            ${court.revealTerms.toString()}`)
    logger.info(` - Appeal terms:                            ${court.appealTerms.toString()}`)
    logger.info(` - Appeal confirmation terms:               ${court.appealConfirmTerms.toString()}`)
    logger.info(` - Juror penalty permyriad:                 ${court.penaltyPct.toString()} ‱`)
    logger.info(` - First round jurors number:               ${court.firstRoundJurorsNumber.toString()}`)
    logger.info(` - Appeal step factor:                      ${court.appealStepFactor.toString()}`)
    logger.info(` - Max regular appeal rounds:               ${court.maxRegularAppealRounds.toString()}`)
    logger.info(` - Final round reduction:                   ${court.finalRoundReduction.toString()} ‱`)
    logger.info(` - Final round lock terms:                  ${court.finalRoundLockTerms.toString()}`)
    logger.info(` - Appeal collateral factor:                ${court.appealCollateralFactor.toString()} ‱`)
    logger.info(` - Appeal confirmation collateral factor:   ${court.appealConfirmCollateralFactor.toString()} ‱`)
    logger.info(` - Minimum ANJ active balance :             ${tokenToString(jurors.minActiveBalance, jurors.token)}`)
  }

  _printDisputesDeploy() {
    logger.info(`Deploying DisputeManager contract ${VERSION} with config:`)
    logger.info(` - Controller:                              ${this.court.address}`)
    logger.info(` - Max number of jurors per draft batch:    ${this.config.court.maxJurorsPerDraftBatch}`)
    logger.info(` - # of skipped disputes:                   ${this.config.court.skippedDisputes}`)
  }

  _printRegistryDeploy(anjAddress, totalActiveBalanceLimit) {
    const { jurors } = this.config
    logger.info(`Deploying JurorsRegistry contract ${VERSION} with config:`)
    logger.info(` - Controller:                              ${this.court.address}`)
    logger.info(` - Jurors token:                            ${jurors.token.symbol} at ${anjAddress}`)
    logger.info(` - Minimum ANJ active balance:              ${tokenToString(jurors.minActiveBalance, jurors.token)}`)
    logger.info(` - Total ANJ active balance limit:          ${tokenToString(totalActiveBalanceLimit, jurors.token)}`)
  }

  _printVotingDeploy() {
    logger.info('Deploying Voting contract with config:')
    logger.info(` - Controller:                              ${this.court.address}`)
  }

  _printTreasuryDeploy() {
    logger.info(`Deploying Treasury contract ${VERSION} with config:`)
    logger.info(` - Controller:                              ${this.court.address}`)
  }

  _printSubscriptionsDeploy() {
    const { subscriptions } = this.config
    logger.info(`Deploying Subscriptions contract ${VERSION} with config:`)
    logger.info(` - Controller:                              ${this.court.address}`)
    logger.info(` - Period duration:                         ${subscriptions.periodDuration} terms`)
    logger.info(` - Fee token:                               ${subscriptions.feeToken.symbol} at ${subscriptions.feeToken.address}`)
    logger.info(` - Fee amount:                              ${tokenToString(subscriptions.feeAmount, subscriptions.feeToken)}`)
    logger.info(` - Pre payment periods:                     ${subscriptions.prePaymentPeriods.toString()} periods`)
    logger.info(` - Resume pre-paid periods:                 ${subscriptions.resumePrePaidPeriods.toString()} periods`)
    logger.info(` - Late payment penalty:                    ${subscriptions.latePaymentPenaltyPct.toString()} ‱`)
    logger.info(` - Governor share:                          ${subscriptions.governorSharePct.toString()} ‱`)
  }
}
