/** Atlas supplies dated activity, membership and ground queries. The animal
 * core owns anatomy/pose arithmetic; it neither samples a world nor rerolls IDs. */
export interface PlanetFaunaPathMember {
  id:string;
  anchorOffsetX:number;anchorOffsetZ:number;
  orbitRadiusM:number;orbitAngularSpeed:number;orbitPhase:number;gaitPeriodS:number;
}
export interface PlanetFaunaActivity {
  pose:{x:number;z:number;yaw:number;gait:'idle'|'walk'|'run'};
  travel:number;revolutionS:number;stateS:number;
}
